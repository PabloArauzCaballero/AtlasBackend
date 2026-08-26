/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un comercio declarado en un partner verificable, con locales, cobro y terminales trazables.
 * @system emite el permiso de subida del QR, comprueba el objeto realmente subido y lo registra como evidencia.
 */
import { Injectable, Logger, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { DocumentStorageService } from '../../../common/storage/document-storage.service.js';
import { MetricsService } from '../../../common/observability/metrics.service.js';
import { PartnerQrCodeModel } from '../../../database/models/index.js';
import { PartnerOnboardingRepository } from '../partner-onboarding.repository.js';
import { QrUploadUrlDto, RegisterQrDto } from '../partner-onboarding.schemas.js';
import { PartnerProfileService } from './partner-profile.service.js';

/**
 * Los dos QR del comercio: el suyo y el de su cuenta bancaria.
 *
 * ## Por qué se guarda la imagen y no el número
 *
 * Un QR de cobro dice a qué cuenta va el dinero. Aceptar el número transcrito y tirar la imagen
 * deja al sistema sin nada que oponer el día que el comercio afirme que él nunca puso esa cuenta.
 * Aquí se conserva el objeto y su `sha256` **calculado sobre el contenido descargado**, no sobre
 * el que declaró quien subió: un hash que aporta el cliente prueba lo que el cliente quiera.
 *
 * ## Por qué un QR no se edita
 *
 * Se reemplaza. El anterior queda en `replaced` apuntando al nuevo. Si un cobro salió mal hay que
 * poder reconstruir contra qué QR se cobró ese día, y un UPDATE en sitio destruye exactamente eso.
 */
@Injectable()
export class PartnerQrService {
  private readonly logger = new Logger(PartnerQrService.name);

  constructor(
    private readonly repository: PartnerOnboardingRepository,
    private readonly profiles: PartnerProfileService,
    private readonly storage: DocumentStorageService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Emite el permiso de subida.
   *
   * La ruta la impone el servidor bajo el prefijo del tenant y del partner, y se firman el tipo y
   * el tamaño: el almacenamiento rechaza cualquier subida que no coincida con lo autorizado. Si el
   * cliente eligiera la ruta, podría escribir sobre la evidencia de otro expediente.
   */
  async createUploadTicket(tenantId: string, partnerId: string, dto: QrUploadUrlDto) {
    const profile = await this.profiles.requireProfile(tenantId, partnerId);
    this.profiles.assertPaymentQrEditable(profile);

    if (!this.storage.isConfigured()) {
      throw new ServiceUnavailableException('DOCUMENT_STORAGE_NOT_CONFIGURED');
    }

    return this.storage.createUploadTicket({
      tenantId,
      subjectId: `partner-${partnerId}`,
      documentType: `qr-${dto.qrKind}`,
      contentType: dto.contentType,
      sizeBytes: dto.sizeBytes,
    });
  }

  /**
   * Registra el QR ya subido, después de MIRAR el objeto.
   *
   * Se descarga y se comprueban tipo y tamaño reales antes de escribir la fila. Fiarse de lo que
   * el cliente declaró dejaría entrar en el expediente una fila que afirma «QR en PNG de 40 KB»
   * sobre un objeto que puede no existir siquiera — y el expediente vale justamente por lo que
   * afirma.
   */
  async register(tenantId: string, partnerId: string, dto: RegisterQrDto): Promise<PartnerQrCodeModel> {
    const profile = await this.profiles.requireProfile(tenantId, partnerId);
    this.profiles.assertPaymentQrEditable(profile);

    const branchId = await this.resolveBranchId(tenantId, partnerId, dto.branchId);

    this.assertOwnedStorageKey(tenantId, partnerId, dto.storageKey);

    const metadata = await this.storage.readObjectMetadata(dto.storageKey);
    if (!metadata) {
      this.metrics.recordPartnerOnboardingStep({ step: `qr_${dto.qrKind}`, outcome: 'rejected' });
      throw new UnprocessableEntityException('QR_OBJECT_NOT_FOUND');
    }
    if (!metadata.contentType?.startsWith('image/')) {
      this.metrics.recordPartnerOnboardingStep({ step: `qr_${dto.qrKind}`, outcome: 'rejected' });
      throw new UnprocessableEntityException(`QR_OBJECT_NOT_AN_IMAGE: ${metadata.contentType}`);
    }

    /*
     * El reemplazo va en la MISMA operación que el alta y en este orden: primero se crea el nuevo
     * y después se marca el viejo apuntando a él. Al revés quedaría una ventana sin ningún QR
     * vigente, y el índice único parcial impediría además tener dos activos a la vez.
     */
    const previous = await this.repository.findLiveQr(tenantId, partnerId, dto.qrKind, branchId);
    const created = await this.repository.createQrCode({
      tenantId,
      partnerProfileId: partnerId,
      branchId,
      qrKind: dto.qrKind,
      storageKey: dto.storageKey,
      // El tipo REAL del objeto, no el que declaró quien subió. La guarda de arriba ya garantiza
      // que es una imagen, así que aquí no hace falta ningún respaldo.
      contentType: metadata.contentType,
      sizeBytes: metadata.sizeBytes,
      sha256: metadata.sha256Hex,
      bankInstitutionCode: dto.bankInstitutionCode ?? null,
      accountNumberMasked: dto.accountNumberMasked ?? null,
    });
    if (previous) await this.repository.markQrReplaced(previous, created.id);

    this.metrics.recordPartnerOnboardingStep({ step: `qr_${dto.qrKind}`, outcome: 'ok' });
    this.logger.log(
      `QR de partner registrado: partnerId=${partnerId} tipo=${dto.qrKind} ` +
        `sucursal=${branchId ?? 'empresa'} reemplaza=${previous?.id ?? 'ninguno'}`,
    );
    return created;
  }

  /**
   * La clave del objeto tiene que caer bajo el prefijo de ESTE tenant y ESTE partner.
   *
   * `createUploadTicket` impone esa ruta al emitir el permiso —y su comentario explica por qué:
   * si el cliente eligiera la ruta podría escribir sobre la evidencia de otro expediente—. Pero el
   * registro aceptaba cualquier `storageKey` que le mandaran, así que la garantía se perdía en el
   * segundo paso: bastaba con pedir un permiso legítimo, ignorarlo, y registrar la clave del QR de
   * OTRO partner —o de otro tenant— como propia. El expediente acabaría afirmando, con su hash y
   * todo, que esa cuenta de cobro es de este comercio.
   *
   * Se comprueba contra la composición real de la clave (`tenant/sujeto/tipo/uuid`), no con un
   * `includes`: una clave `9/partner-7/qr/…` contiene el texto «partner-7» y también lo contendría
   * «partner-77».
   */
  private assertOwnedStorageKey(tenantId: string, partnerId: string, storageKey: string): void {
    const expectedPrefix = `${tenantId}/partner-${partnerId}/`;
    if (!storageKey.startsWith(expectedPrefix)) {
      this.metrics.recordPartnerOnboardingStep({ step: 'qr_storage_key', outcome: 'rejected' });
      this.logger.warn(`Clave de objeto fuera del expediente: tenant=${tenantId} partner=${partnerId} clave=${storageKey}`);
      throw new UnprocessableEntityException('QR_OBJECT_OUTSIDE_PARTNER_SCOPE');
    }
  }

  list(tenantId: string, partnerId: string): Promise<PartnerQrCodeModel[]> {
    return this.repository.listQrCodes(tenantId, partnerId);
  }

  /**
   * El QR de cobro VIGENTE del comercio: el que hay que enseñarle al cliente para que transfiera.
   *
   * Es el bancario, no el «del negocio»: aquél es el cartel de la tienda y éste es la cuenta a la
   * que va el dinero. Confundirlos enseñaría al cliente un código que su banco no sabe leer.
   *
   * Devuelve el vigente de la EMPRESA (`branchId` nulo). El QR de una sucursal concreta existe para
   * el cobro en mostrador; una cuota se transfiere al comercio, no a la caja donde se compró.
   */
  findLivePaymentQr(tenantId: string, partnerId: string): Promise<PartnerQrCodeModel | null> {
    return this.repository.findLiveQr(tenantId, partnerId, 'bank', null);
  }

  /**
   * Los bytes de un QR ya registrado, para poder MIRARLO.
   *
   * Se subía la imagen y no había forma de volver a verla: el expediente enseñaba una tabla con el
   * prefijo del hash, que prueba que el archivo existe pero no deja comprobar si el comercio subió
   * el QR correcto. Un comercio que se equivoca de imagen no se entera hasta que un cliente
   * transfiere a la cuenta de otro.
   *
   * Se sirven los bytes en vez de una URL prefirmada por lo mismo que en la evidencia de identidad:
   * un enlace firmado funciona sin sesión mientras no venza, y aquí cada lectura tiene que pasar
   * por el token y el rol de quien pregunta.
   */
  async readQrImage(tenantId: string, partnerId: string, qrId: string): Promise<{ bytes: Buffer; contentType: string }> {
    const codes = await this.repository.listQrCodes(tenantId, partnerId);
    const qr = codes.find((code) => String(code.id) === String(qrId));
    if (!qr) throw new NotFoundException('QR_NOT_FOUND');

    const bytes = await this.storage.readObject(qr.storageKey);
    if (!bytes) throw new NotFoundException('QR_OBJECT_NOT_FOUND');
    return { bytes, contentType: qr.contentType };
  }

  /** La sucursal tiene que ser de ESTE partner: si no, un QR podría colgarse del local de otro. */
  private async resolveBranchId(tenantId: string, partnerId: string, branchId?: string): Promise<string | null> {
    if (branchId === undefined) return null;
    const branch = await this.repository.findBranchById(tenantId, partnerId, branchId);
    if (!branch) throw new NotFoundException('La sucursal no pertenece a este partner.');
    return branch.id;
  }
}
