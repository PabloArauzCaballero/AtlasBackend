/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza da al ERP un almacén de documentos con las mismas garantías que la evidencia del cliente.
 * @system emite permisos de subida por dueño, verifica el objeto subido y lo sirve por bytes autenticados.
 */
import { Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import {
  AllowedEvidenceMimeType,
  DocumentStorageService,
  StoredObjectMetadata,
  UploadTicket,
} from '../../../common/storage/document-storage.service.js';

/** El prefijo bajo el que viven TODOS los documentos que sube el ERP. Es lo que impide leer otra cosa. */
const ERP_SUBJECT_PREFIX = 'erp-';

/**
 * Documentos del ERP en el almacén de evidencia de Atlas.
 *
 * Hasta el 2026-09-14 los «Documentos KYB / respaldo» del ERP iban a Cloudinary, que además no
 * estaba configurado en ningún entorno: el botón fallaba con 503 y, de haber funcionado, habría
 * publicado un documento KYB en una URL sin sesión con una firma que sólo cubría la carpeta. El
 * checklist de onboarding del comercio directamente no admitía archivo.
 *
 * Aquí se aplica el mismo contrato que a la evidencia del cliente y al poder del comercio: la ruta
 * del objeto la impone el servidor (`${tenantId}/erp-<dueño>/<tipo>/<uuid>`), se firman tipo y
 * tamaño, el objeto se verifica (hash, tamaño, magic bytes, antivirus si está) antes de darlo por
 * registrado, y se sirve por bytes con sesión, nunca por URL.
 */
@Injectable()
export class ErpDocumentsService {
  constructor(private readonly storage: DocumentStorageService) {}

  createUploadTicket(input: {
    tenantId: string;
    ownerType: string;
    ownerId: string;
    documentKind: string;
    contentType: AllowedEvidenceMimeType;
    sizeBytes: number;
  }): UploadTicket {
    this.assertConfigured();
    return this.storage.createUploadTicket({
      tenantId: input.tenantId,
      subjectId: `${ERP_SUBJECT_PREFIX}${sanitize(input.ownerType)}-${sanitize(input.ownerId)}`,
      documentType: sanitize(input.documentKind),
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });
  }

  /** Comprueba que el objeto declarado existe bajo el prefijo del ERP y es lo que dice ser. */
  async verify(input: {
    tenantId: string;
    storageKey: string;
    sha256: string;
    contentType: AllowedEvidenceMimeType;
    sizeBytes: number | null;
  }): Promise<StoredObjectMetadata> {
    this.assertConfigured();
    this.assertErpKey(input.tenantId, input.storageKey);
    const result = await this.storage.verifyDeclaredObject({
      storageKey: input.storageKey,
      declaredSha256: input.sha256,
      declaredMimeType: input.contentType,
      declaredSizeBytes: input.sizeBytes,
    });
    if (!result.ok) throw new UnprocessableEntityException(result.reason);
    return result.metadata;
  }

  async read(tenantId: string, storageKey: string): Promise<{ bytes: Buffer; contentType: string }> {
    this.assertConfigured();
    this.assertErpKey(tenantId, storageKey);
    const head = await this.storage.headObject(storageKey);
    if (!head) throw new NotFoundException('ERP_DOCUMENT_NOT_FOUND');
    const bytes = await this.storage.readObject(storageKey);
    if (!bytes) throw new NotFoundException('ERP_DOCUMENT_NOT_FOUND');
    return { bytes, contentType: head.contentType ?? 'application/octet-stream' };
  }

  private assertConfigured(): void {
    if (!this.storage.isConfigured()) throw new ServiceUnavailableException('DOCUMENT_STORAGE_NOT_CONFIGURED');
  }

  /**
   * Sólo claves del tenant y del ERP. Sin esto, el ERP —con un token interno— podría leer el carnet
   * de un cliente o el QR de un comercio por su clave: el prefijo es la frontera.
   */
  private assertErpKey(tenantId: string, storageKey: string): void {
    if (!storageKey.startsWith(`${tenantId}/${ERP_SUBJECT_PREFIX}`)) {
      throw new UnprocessableEntityException('ERP_DOCUMENT_KEY_NOT_OWNED');
    }
  }
}

function sanitize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .slice(0, 80);
}
