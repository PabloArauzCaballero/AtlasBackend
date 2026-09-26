/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza acredita quién firma por el comercio: el representante y el poder que lo respalda.
 * @system emite el permiso de subida del poder, comprueba que el objeto es de este expediente y lo declara.
 */
import { Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { MetricsService } from '../../../common/observability/metrics.service.js';
import { DocumentStorageService } from '../../../common/storage/document-storage.service.js';
import { ExpedienteHooksService } from '../../expedientes/application/expediente-hooks.service.js';
import { PartnerCommercialNetworkRepository } from '../partner-commercial-network.repository.js';
import { LegalRepresentativeDto, PartnerDocumentUploadUrlDto } from '../partner-onboarding.schemas.js';
import { PartnerProfileService } from './partner-profile.service.js';
import { assertEditable } from './partner-profile.guards.js';

/**
 * El representante legal y su poder.
 *
 * Vivía en `PartnerProfileService` hasta que el expediente de archivos del comercio (ADR-0010) hizo
 * crecer aquel servicio por encima del tope de 300 líneas. Separarlo es honesto además de
 * necesario: declarar a quien firma no es abrir ni decidir el expediente, y es la única parte del
 * perfil que toca el almacén de documentos.
 */
@Injectable()
export class PartnerRepresentativeService {
  private readonly logger = new Logger(PartnerRepresentativeService.name);

  constructor(
    private readonly profiles: PartnerProfileService,
    private readonly network: PartnerCommercialNetworkRepository,
    private readonly metrics: MetricsService,
    private readonly storage: DocumentStorageService,
    private readonly expedienteHooks: ExpedienteHooksService,
  ) {}

  /**
   * Permiso de subida para un documento del expediente (hoy, el poder notarial).
   *
   * Mismo patrón que el del QR y por el mismo motivo: la ruta la impone el servidor bajo el
   * prefijo del tenant y del partner, y se firman tipo y tamaño. Si el cliente eligiera la ruta,
   * podría escribir sobre la evidencia de otro expediente.
   */
  createDocumentUploadTicket(tenantId: string, partnerId: string, dto: PartnerDocumentUploadUrlDto) {
    if (!this.storage.isConfigured()) {
      throw new ServiceUnavailableException('DOCUMENT_STORAGE_NOT_CONFIGURED');
    }
    return this.storage.createUploadTicket({
      tenantId,
      subjectId: `partner-${partnerId}`,
      documentType: dto.documentKind,
      contentType: dto.contentType,
      sizeBytes: dto.sizeBytes,
    });
  }

  /**
   * Declara al representante legal.
   *
   * Se AÑADE en vez de reemplazar al anterior: un negocio puede tener varios apoderados, y cuando
   * cambia el que firma, saber quién firmaba antes es justo lo que hace auditable un contrato
   * viejo. El poder es opcional aquí y exigido al enviar —se permite guardar a la persona antes de
   * tener el papel escaneado, que es como ocurre de verdad—.
   */
  async addLegalRepresentative(tenantId: string, partnerId: string, dto: LegalRepresentativeDto) {
    const profile = await this.profiles.requireProfile(tenantId, partnerId);
    assertEditable(profile);

    /*
     * Si viene el poder, tiene que ser un objeto de ESTE expediente y tiene que existir.
     *
     * Es la misma lección que dejó el QR: aceptar la clave que mande el cliente permite registrar
     * como propio el documento de otro partner —o afirmar un poder que nadie subió—, y el
     * expediente vale exactamente por lo que afirma.
     */
    let poder: { contentType: string | null; sizeBytes: number; sha256Hex: string | null } | null = null;
    if (dto.powerOfAttorneyKey) {
      const prefijoEsperado = `${tenantId}/partner-${partnerId}/`;
      if (!dto.powerOfAttorneyKey.startsWith(prefijoEsperado)) {
        throw new UnprocessableEntityException('POWER_OF_ATTORNEY_OUTSIDE_PARTNER_SCOPE');
      }
      poder = await this.storage.readObjectMetadata(dto.powerOfAttorneyKey);
      if (!poder) {
        throw new UnprocessableEntityException('POWER_OF_ATTORNEY_OBJECT_NOT_FOUND');
      }
    }

    const representative = await this.network.createRepresentative({
      tenantId,
      partnerProfileId: partnerId,
      fullName: dto.fullName,
      documentType: dto.documentType,
      documentNumber: dto.documentNumber,
      powerOfAttorneyKey: dto.powerOfAttorneyKey ?? null,
    });

    this.metrics.recordPartnerOnboardingStep({ step: 'legal_representative', outcome: 'ok' });
    // Ni el nombre ni el documento se registran: son datos personales de una persona identificable.
    this.logger.log(`Representante legal declarado: partnerId=${partnerId} representante=${representative.id}`);

    // El poder es un archivo que el comercio subió: va a su carpeta (Operaciones › Archivos) con lo
    // que el almacén ya dijo de él. El gancho se traga sus fallos: el representante ya está declarado.
    if (dto.powerOfAttorneyKey && poder) {
      await this.expedienteHooks.alRegistrarArchivoDelComercio({
        tenantId,
        partnerId,
        documentType: 'partner_power_of_attorney',
        storageKey: dto.powerOfAttorneyKey,
        objeto: poder,
      });
    }
    return representative;
  }
}
