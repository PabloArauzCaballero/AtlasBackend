/**
 * @file Servicio de aplicación: registra una evidencia de apoyo que no pertenece a ningún paquete.
 * @business Lo copiado de la competencia que sí sirve: QR de cobro sin monto como prueba bancaria, factura de servicio como prueba de domicilio, audio de ocupación.
 * @system verifica que el objeto subido es del cliente y existe en el almacén, y lo registra como `evidence_documents` + extracción pendiente de revisión.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { DocumentStorageService } from '../../../common/storage/document-storage.service.js';
import type { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResource } from '../../../common/utils/auth/ownership.util.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import type { SupportingEvidenceDto } from '../customer-supporting-evidence.schemas.js';
import { IdentityEvidenceVerificationService } from './identity-evidence-verification.service.js';

/**
 * ## Por qué un endpoint aparte y no «más evidencia en el paquete de identidad»
 *
 * El paquete de identidad es atómico y se congela; estas tres evidencias llegan en la fase 3, son
 * OPCIONALES y ninguna decide sola: el QR prueba que hay una cuenta bancaria activa, la factura
 * prueba domicilio, el audio explica la ocupación con la voz de la persona. Se registran con
 * `requires_review = true`: quien las mira es el analista (decisión R3 del plan del 2026-09-17: sin
 * transcripción automática en v1).
 *
 * Con el QR NO se cobra ni se deposita nada. Lo dice la pantalla y lo cumple el código: aquí sólo
 * se guarda la imagen.
 */
@Injectable()
export class CustomerSupportingEvidenceService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    private readonly verification: IdentityEvidenceVerificationService,
    private readonly storageService: DocumentStorageService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async register(input: {
    tenantId: string;
    customerId: string;
    body: SupportingEvidenceDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
  }): Promise<{ evidenceId: string; evidenceType: string; status: 'pending_review'; uploadedAt: string }> {
    assertOwnCustomerResource(input.currentUser, input.customerId);
    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const item = { ...input.body, fileSizeBytes: input.body.fileSizeBytes ?? null };
    this.verification.assertBelongsToCustomer(input.tenantId, input.customerId, [item]);
    const verified = await this.verification.verifyObjects([item]);
    const metadata = verified.get(input.body.storageKey);
    const now = new Date();

    const evidenceId = await this.sequelize.transaction(async (transaction) => {
      const evidence = await this.onboardingRepository.createEvidenceDocument(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          documentType: input.body.evidenceType,
          storageKey: input.body.storageKey,
          bucket: this.storageService.getBucket(),
          mimeType: input.body.mimeType,
          sha256Hash: metadata?.sha256Hex ?? input.body.sha256Hash,
          fileSizeBytes: String(metadata?.sizeBytes ?? 0),
          sessionId: null,
          ipAddress: input.ipAddress,
          uploadedAt: now,
        },
        { transaction },
      );
      await this.onboardingRepository.createEvidenceExtraction(
        {
          tenantId: input.tenantId,
          evidenceDocumentId: String(evidence.id),
          extractedAt: now,
          requiresReview: true,
          extractedDataJson: { kind: input.body.evidenceType, note: input.body.note ?? null },
        },
        { transaction },
      );
      return String(evidence.id);
    });

    return { evidenceId, evidenceType: input.body.evidenceType, status: 'pending_review', uploadedAt: now.toISOString() };
  }
}
