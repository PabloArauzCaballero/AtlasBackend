/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { MAX_EVIDENCE_BYTES, DocumentStorageService } from '../../../common/storage/document-storage.service.js';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { EDITABLE_ONBOARDING_STATUSES, normalizeLifecycleStatus } from '../../customers/customer-lifecycle.constants.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { UploadUrlRequestDto } from '../customer-onboarding-profile.schemas.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';

/**
 * Emisión del permiso de subida de evidencia documental.
 *
 * Resuelve el punto ciego del KYC anterior: el cliente elegía la ruta del objeto (`storageKey`) y
 * declaraba su hash, y el backend guardaba ambas cosas sin haber visto nunca el archivo. Ahora el
 * servidor impone la ruta bajo el prefijo del tenant y del cliente, y firma el tipo y el tamaño, de
 * modo que el almacenamiento rechaza cualquier subida que no coincida con lo autorizado.
 */
@Injectable()
export class CustomerDocumentUploadService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    private readonly storageService: DocumentStorageService,
  ) {}

  async createUploadUrl(input: {
    tenantId: string;
    customerId: string;
    body: UploadUrlRequestDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
  }) {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);

    if (!this.storageService.isConfigured()) {
      throw new ServiceUnavailableException('DOCUMENT_STORAGE_NOT_CONFIGURED');
    }

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const status = normalizeLifecycleStatus(customer.lifecycleStatus);
    if (!EDITABLE_ONBOARDING_STATUSES.includes(status)) {
      throw new UnprocessableEntityException(`PROFILE_NOT_EDITABLE_IN_STATUS: ${status}`);
    }
    if (input.body.sizeBytes > MAX_EVIDENCE_BYTES) {
      throw new UnprocessableEntityException(`EVIDENCE_OBJECT_TOO_LARGE: max=${MAX_EVIDENCE_BYTES}`);
    }

    const ticket = this.storageService.createUploadTicket({
      tenantId: input.tenantId,
      customerId: input.customerId,
      documentType: input.body.documentType,
      contentType: input.body.contentType,
      sizeBytes: input.body.sizeBytes,
    });

    await this.onboardingRepository.createOperationalAuditLog(
      {
        tenantId: input.tenantId,
        actorType: input.currentUser.role,
        actorInternalUserId: input.currentUser.internalUserId ?? null,
        actionCode: 'customer_onboarding.document_upload_url_issued',
        targetType: 'customer',
        targetId: input.customerId,
        ipAddress: input.ipAddress,
        userAgent: null,
        // La URL firmada NO se audita: es una credencial temporal de escritura.
        payloadJson: { storageKey: ticket.storageKey, documentType: input.body.documentType, contentType: input.body.contentType },
        occurredAt: new Date(),
      },
      {},
    );

    return ticket;
  }
}
