/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza da al ERP un almacén de documentos con las mismas garantías que la evidencia del cliente.
 * @system emite permisos de subida por dueño, verifica el objeto subido y lo sirve por bytes autenticados.
 */
import { Injectable, Logger, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import {
  AllowedEvidenceMimeType,
  DocumentStorageService,
  StoredObjectMetadata,
  UploadTicket,
} from '../../../common/storage/document-storage.service.js';
import { ExpedienteHooksService } from '../../expedientes/application/expediente-hooks.service.js';
import { PartnerOnboardingRepository } from '../partner-onboarding.repository.js';

/** El prefijo bajo el que viven TODOS los documentos que sube el ERP. Es lo que impide leer otra cosa. */
const ERP_SUBJECT_PREFIX = 'erp-';

/**
 * El único dueño del ERP que Atlas sabe atar a un comercio: la cuenta B2B, porque
 * `partner_profiles.erp_account_id` apunta a ella (`PATCH /operations/partners/:id/erp-account`).
 * `ONBOARDING_CASE`, `BUSINESS_PARTNER` y `GL_ACCOUNT` son identificadores internos del ERP que
 * aquí no existen en ninguna tabla; sus documentos no se anotan en ningún expediente.
 */
const ERP_OWNER_B2B_ACCOUNT = 'b2b_account';

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
  private readonly logger = new Logger(ErpDocumentsService.name);

  constructor(
    private readonly storage: DocumentStorageService,
    private readonly profiles: PartnerOnboardingRepository,
    private readonly expedienteHooks: ExpedienteHooksService,
  ) {}

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
    await this.anotarEnExpedienteDelComercio(input.tenantId, input.storageKey, result.metadata);
    return result.metadata;
  }

  /**
   * Un documento de la cuenta B2B de un comercio se ve también en su expediente.
   *
   * La clave dice quién es el dueño (`<tenant>/erp-<tipo>-<id>/<clase>/<uuid>`), porque el ERP no
   * manda otra cosa al verificar. Si el dueño es una cuenta B2B enlazada a un `partner_profiles`,
   * el archivo se anota en la carpeta «documentos» de ese comercio con el nombre de su clase (`kyb`,
   * `adjunto`…). Nada de esto puede hacer fallar la verificación: el ERP ya tiene el objeto y lo
   * registra por su cuenta, y el expediente es una vista.
   */
  private async anotarEnExpedienteDelComercio(tenantId: string, storageKey: string, metadata: StoredObjectMetadata): Promise<void> {
    try {
      const dueno = parseErpOwner(tenantId, storageKey);
      if (!dueno || dueno.ownerType !== ERP_OWNER_B2B_ACCOUNT) return;
      const { rows } = await this.profiles.findProfilesByExternalKeys(tenantId, { erpAccountId: dueno.ownerId }, { limit: 1, offset: 0 });
      const profile = rows[0];
      if (!profile) return;
      await this.expedienteHooks.alRegistrarArchivoDelComercio({
        tenantId,
        partnerId: profile.id,
        documentType: 'partner_document',
        nombreBase: dueno.documentKind,
        origen: 'portal',
        storageKey,
        objeto: metadata,
      });
    } catch (error) {
      this.logger.warn(`No se pudo anotar ${storageKey} en el expediente del comercio: ${(error as Error).message}`);
    }
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

/** Deshace la composición de `createUploadTicket`. `null` si la clave no tiene esa forma. */
export function parseErpOwner(tenantId: string, storageKey: string): { ownerType: string; ownerId: string; documentKind: string } | null {
  const partes = storageKey.split('/');
  if (partes.length !== 4 || partes[0] !== tenantId || !partes[1].startsWith(ERP_SUBJECT_PREFIX)) return null;
  const dueno = partes[1].slice(ERP_SUBJECT_PREFIX.length);
  // El tipo de dueño no lleva guiones (`b2b_account`); el id sí puede (un UUID). Se corta en el primero.
  const corte = dueno.indexOf('-');
  if (corte <= 0 || corte === dueno.length - 1) return null;
  return { ownerType: dueno.slice(0, corte), ownerId: dueno.slice(corte + 1), documentKind: partes[2] };
}

function sanitize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .slice(0, 80);
}
