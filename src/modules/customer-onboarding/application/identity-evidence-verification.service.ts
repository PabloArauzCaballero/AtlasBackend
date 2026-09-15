/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un registro inicial en un cliente verificable, conforme y listo para evaluación financiera.
 * @system orquesta perfil, contactos, identidad, documentos, dirección, referencias, screening y estado del flujo.
 */
import { Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { DocumentStorageService } from '../../../common/storage/document-storage.service.js';
import { IdentityPackageDto } from '../customer-onboarding.schemas.js';

export type VerifiedEvidence = Map<string, { sizeBytes: number; sha256Hex: string }>;

/**
 * Comprobación de los objetos de evidencia contra el almacenamiento real.
 *
 * Separado de `CustomerIdentityPackageService` porque responde a una pregunta anterior e
 * independiente de la persistencia: "¿estos archivos son los que dicen ser, y son de este cliente?".
 * Todo lo que hay aquí ocurre ANTES de abrir la transacción del paquete.
 */
@Injectable()
export class IdentityEvidenceVerificationService {
  constructor(private readonly storageService: DocumentStorageService) {}

  /**
   * El objeto declarado tiene que vivir bajo el prefijo que el propio servidor asignó al emitir el
   * permiso de subida (`${tenantId}/${customerId}/…`). Sin esta comprobación el paquete aceptaba
   * cualquier ruta del bucket, incluida la de la evidencia de otro cliente: bastaba conocerla para
   * adjuntarla al expediente propio.
   */
  assertBelongsToCustomer(tenantId: string, customerId: string, evidence: IdentityPackageDto['evidence']): void {
    const prefix = `${tenantId}/${customerId}/`;
    for (const item of evidence) {
      if (!item.storageKey.startsWith(prefix)) {
        throw new UnprocessableEntityException(`EVIDENCE_STORAGE_KEY_NOT_OWNED: ${item.evidenceType}`);
      }
    }
  }

  /**
   * Descarga y valida cada objeto declarado. Falla el paquete completo ante el primer problema: una
   * evidencia que no se pudo verificar no es evidencia, y aceptar el resto dejaría un documento de
   * identidad a medio respaldar.
   */
  async verifyObjects(evidence: IdentityPackageDto['evidence']): Promise<VerifiedEvidence> {
    if (!this.storageService.isConfigured()) {
      throw new ServiceUnavailableException('DOCUMENT_STORAGE_NOT_CONFIGURED');
    }
    const verified: VerifiedEvidence = new Map();
    for (const item of evidence) {
      const result = await this.storageService.verifyDeclaredObject({
        storageKey: item.storageKey,
        declaredSha256: item.sha256Hash,
        declaredMimeType: item.mimeType,
        declaredSizeBytes: item.fileSizeBytes ? Number(item.fileSizeBytes) : null,
      });
      if (!result.ok) {
        throw new UnprocessableEntityException(`${result.reason}: ${item.evidenceType}`);
      }
      verified.set(item.storageKey, { sizeBytes: result.metadata.sizeBytes, sha256Hex: result.metadata.sha256Hex });
    }
    return verified;
  }
}
