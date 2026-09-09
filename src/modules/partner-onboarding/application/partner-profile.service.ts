/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un comercio declarado en un partner verificable, con locales, cobro y terminales trazables.
 * @system abre el expediente del partner, comprueba lo que exige el envío y publica su estado.
 */
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MetricsService } from '../../../common/observability/metrics.service.js';
import { DocumentStorageService } from '../../../common/storage/document-storage.service.js';
import {
  COMMERCIAL_NETWORK_EDITABLE_STATUSES,
  EDITABLE_PARTNER_STATUSES,
  PAYMENT_QR_EDITABLE_STATUSES,
  PartnerOnboardingRepository,
} from '../partner-onboarding.repository.js';
import {
  LegalRepresentativeDto,
  PartnerDocumentUploadUrlDto,
  StartPartnerOnboardingDto,
  UpdateCommercialProfileDto,
} from '../partner-onboarding.schemas.js';
import { PartnerProfileModel } from '../../../database/models/index.js';
import { PartnerVerificationService, type SubmissionGap } from './partner-verification.service.js';

/** Lo que el expediente tiene que reunir antes de poder enviarse a revisión. */

@Injectable()
export class PartnerProfileService {
  private readonly logger = new Logger(PartnerProfileService.name);

  constructor(
    private readonly repository: PartnerOnboardingRepository,
    private readonly metrics: MetricsService,
    private readonly storage: DocumentStorageService,
    private readonly verification: PartnerVerificationService,
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
   * Abre el expediente.
   *
   * Rechaza el NIT repetido en vez de crear un segundo expediente, y ésa es la decisión que
   * sostiene todo lo demás: dos expedientes del mismo negocio son dos verificaciones que pueden
   * contradecirse, y nada obliga a mirar la otra. El conflicto se responde con el identificador
   * del que ya existe para que el portal lleve al comercio a continuar el suyo en vez de dejarlo
   * en un callejón sin salida.
   */
  async start(
    tenantId: string,
    dto: StartPartnerOnboardingDto,
    owner: { role: string; merchantUserId?: string } | undefined = undefined,
  ): Promise<PartnerProfileModel> {
    const existing = await this.repository.findProfileByTaxId(tenantId, dto.taxId);
    if (existing) {
      this.metrics.recordPartnerOnboardingStep({ step: 'start', outcome: 'rejected' });
      /*
       * El identificador va en el MENSAJE y no en un campo aparte porque el filtro global de
       * excepciones sólo publica `{ code genérico, message }`: cualquier dato que se cuelgue del
       * cuerpo se pierde por el camino. Sin él, el portal recibe «ya existe» y no puede llevar al
       * comercio a continuar su expediente, que es justo lo que evita el callejón sin salida.
       */
      throw new ConflictException(
        `PARTNER_TAX_ID_ALREADY_REGISTERED: ya existe el expediente ${existing.id} para ese NIT ` +
          `(estado ${existing.onboardingStatus}).`,
      );
    }

    const profile = await this.repository.createProfile({
      tenantId,
      legalName: dto.legalName,
      tradeName: dto.tradeName ?? null,
      taxId: dto.taxId,
      commercialRegistry: dto.commercialRegistry ?? null,
      businessCategory: dto.businessCategory ?? null,
      contactEmail: dto.contactEmail,
      contactPhone: dto.contactPhone ?? null,
      /*
       * Quien abre el expediente queda como su dueño, y es contra esto que `PartnerOwnershipGuard`
       * comprueba después. Sólo si es un comercio: un expediente abierto por personal interno no
       * pertenece a ningún comercio en concreto, y ponerle un dueño inventado le daría a alguien
       * autoservicio sobre un expediente que no abrió.
       */
      ownerMerchantUserId: owner?.role === 'merchant' ? (owner.merchantUserId ?? null) : null,
    });

    this.metrics.recordPartnerOnboardingStep({ step: 'start', outcome: 'ok' });
    // El NIT no se registra: identifica fiscalmente a un negocio y es dato sensible en un log.
    this.logger.log(`Expediente de partner abierto: partnerId=${profile.id} tenant=${tenantId}`);
    return profile;
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
    const profile = await this.requireProfile(tenantId, partnerId);
    this.assertEditable(profile);

    /*
     * Si viene el poder, tiene que ser un objeto de ESTE expediente y tiene que existir.
     *
     * Es la misma lección que dejó el QR: aceptar la clave que mande el cliente permite registrar
     * como propio el documento de otro partner —o afirmar un poder que nadie subió—, y el
     * expediente vale exactamente por lo que afirma.
     */
    if (dto.powerOfAttorneyKey) {
      const prefijoEsperado = `${tenantId}/partner-${partnerId}/`;
      if (!dto.powerOfAttorneyKey.startsWith(prefijoEsperado)) {
        throw new UnprocessableEntityException('POWER_OF_ATTORNEY_OUTSIDE_PARTNER_SCOPE');
      }
      const objeto = await this.storage.readObjectMetadata(dto.powerOfAttorneyKey);
      if (!objeto) {
        throw new UnprocessableEntityException('POWER_OF_ATTORNEY_OBJECT_NOT_FOUND');
      }
    }

    const representative = await this.repository.createRepresentative({
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
    return representative;
  }

  /**
   * Completa la matrícula de comercio, que puede llegar después del alta.
   *
   * Es su propio método y no un `update` genérico del perfil a propósito: los demás campos del
   * expediente identifican al negocio y cambiarlos después de haberlo verificado sería empezar de
   * nuevo, no corregir. La matrícula es el único dato que el flujo admite completar más tarde.
   */
  async setCommercialRegistry(tenantId: string, partnerId: string, commercialRegistry: string) {
    const profile = await this.requireProfile(tenantId, partnerId);
    this.assertEditable(profile);
    return this.repository.updateProfile(profile, { commercialRegistry });
  }

  /**
   * Corrige la ficha comercial: nombre de fachada, rubro y teléfono.
   *
   * Es el complemento de `setCommercialRegistry` para el otro lado del expediente. Aquel completa
   * un dato de identidad que puede llegar tarde; éste corrige datos que CAMBIAN mientras el negocio
   * opera —un local se rebautiza, un rubro se declaró mal el primer día, un teléfono se da de baja—
   * y por eso admite el expediente ya aprobado: negárselo obligaría a reabrir una verificación de
   * identidad para arreglar un nombre de fachada.
   *
   * Lo que no toca, y por eso no está en el esquema, es lo que el analista verificó: razón social,
   * NIT y matrícula. Cambiar eso no es corregir la ficha, es aprobar otra empresa con la firma de
   * la primera.
   */
  async updateCommercialProfile(tenantId: string, partnerId: string, dto: UpdateCommercialProfileDto) {
    const profile = await this.requireProfile(tenantId, partnerId);
    this.assertCommercialNetworkEditable(profile);

    const changes: Record<string, string> = {};
    if (dto.tradeName !== undefined) changes.tradeName = dto.tradeName;
    if (dto.businessCategory !== undefined) changes.businessCategory = dto.businessCategory;
    if (dto.contactPhone !== undefined) changes.contactPhone = dto.contactPhone;

    const updated = await this.repository.updateProfile(profile, changes);
    // Se registran los CAMPOS que cambiaron, no sus valores: el teléfono de contacto identifica a
    // una persona y el log no es el sitio donde debe quedar.
    this.logger.log(`Ficha comercial actualizada: partnerId=${partnerId} campos=${Object.keys(changes).join(',')}`);
    return updated;
  }

  /**
   * Cómo se llaman y de qué rubro son varios comercios, en una sola consulta.
   *
   * Lo que se devuelve es lo MÍNIMO que una pantalla del cliente necesita para reconocer dónde
   * compró: el nombre de la fachada y el rubro. Ni el NIT, ni el correo, ni el estado del
   * expediente — el cliente no es parte de la relación entre Atlas y ese comercio, y una pantalla
   * de gastos no es sitio para publicar la ficha de un tercero.
   *
   * Un identificador que no resuelve simplemente no aparece en el mapa: quien lo consulte decide
   * qué hacer con la ausencia, que en la práctica es agrupar esos créditos como «sin comercio».
   */
  async describeMany(
    tenantId: string,
    partnerIds: readonly string[],
  ): Promise<Map<string, { displayName: string; businessCategory: string | null }>> {
    const profiles = await this.repository.findProfilesByIds(tenantId, partnerIds);
    return new Map(
      profiles.map((profile) => [
        String(profile.id),
        { displayName: profile.tradeName ?? profile.legalName, businessCategory: profile.businessCategory ?? null },
      ]),
    );
  }

  /**
   * Los expedientes de este comercio, para que el portal sepa a cual entrar.
   *
   * Devuelve lo minimo con lo que la pantalla puede trabajar —identificador, nombre y estado—: el
   * detalle ya lo sirve `:partnerId/status`, y duplicarlo aqui solo daria dos formas distintas de
   * responder a la misma pregunta.
   */
  async listOwnedBy(
    tenantId: string,
    ownerMerchantUserId: string,
  ): Promise<{ partnerId: string; legalName: string | null; tradeName: string | null; status: string }[]> {
    const profiles = await this.repository.findProfilesByOwner(tenantId, ownerMerchantUserId);
    return profiles.map((profile) => ({
      partnerId: String(profile.id),
      legalName: profile.legalName ?? null,
      tradeName: profile.tradeName ?? null,
      status: profile.onboardingStatus,
    }));
  }

  /**
   * Resuelve un terminal del comercio por su id, comprobando que sea DE ESTE comercio.
   *
   * Lo usa el alta de solicitud: el cliente trae el id del terminal que resolvió al escanear, y hay
   * que atarlo a la compra sin dar por bueno que pertenezca a quien dice. Devuelve `null` si no
   * existe o es de otro comercio —ahí la compra simplemente no recuerda la caja, que es mejor que
   * atribuirla a una equivocada—.
   */
  /**
   * Fija la comisión del comercio. Es un término comercial, no un dato de identidad, así que se puede
   * ajustar en cualquier momento —también con el expediente ya aprobado—: lo negocia Atlas, no lo
   * declara el comercio, y por eso vive detrás de una ruta interna y no del portal del negocio.
   */
  async setMdrRate(tenantId: string, partnerId: string, mdrRatePercent: number) {
    const profile = await this.requireProfile(tenantId, partnerId);
    return this.repository.updateProfile(profile, { mdrRatePercent: mdrRatePercent.toFixed(2) });
  }

  async findOwnedTerminal(tenantId: string, partnerId: string, terminalId: string) {
    return this.repository.findPosById(tenantId, partnerId, terminalId);
  }

  /**
   * Un índice terminalId -> {sucursal, caja} para todos los terminales del comercio.
   *
   * Se hace en dos consultas (terminales y sucursales del comercio) y se cruza en memoria, para no
   * pegarle a la base una vez por cada solicitud del listado. Con él, la pantalla del comercio puede
   * decir en qué local nació cada compra sin exponer nada del cliente.
   */
  async terminalDirectory(tenantId: string, partnerId: string) {
    const [terminales, sucursales] = await Promise.all([
      this.repository.listPosTerminals(tenantId, partnerId),
      this.repository.listBranches(tenantId, partnerId),
    ]);
    const branchById = new Map(sucursales.map((b) => [String(b.id), b]));
    const map = new Map<
      string,
      { branchId: string; branchName: string; branchCode: string; terminalAlias: string | null; terminalSerial: string }
    >();
    for (const t of terminales) {
      const branch = branchById.get(String(t.branchId));
      map.set(String(t.id), {
        branchId: String(t.branchId),
        branchName: branch?.name ?? '',
        branchCode: branch?.branchCode ?? '',
        terminalAlias: t.terminalAlias,
        terminalSerial: t.terminalSerial,
      });
    }
    return map;
  }

  async requireProfile(tenantId: string, partnerId: string): Promise<PartnerProfileModel> {
    const profile = await this.repository.findProfileById(tenantId, partnerId);
    if (!profile) throw new NotFoundException('Expediente de partner no encontrado.');
    return profile;
  }

  /**
   * Un expediente ya enviado o resuelto no admite cambios del comercio.
   *
   * Sin esta puerta, un comercio podría cambiar su QR bancario mientras un analista mira el
   * expediente, y la aprobación quedaría firmada sobre datos que ya no son los que se revisaron.
   */
  assertEditable(profile: PartnerProfileModel): void {
    if (!EDITABLE_PARTNER_STATUSES.includes(profile.onboardingStatus as (typeof EDITABLE_PARTNER_STATUSES)[number])) {
      throw new UnprocessableEntityException(`PARTNER_NOT_EDITABLE_IN_STATUS: ${profile.onboardingStatus}`);
    }
  }

  /**
   * Igual que `assertEditable`, pero para la red comercial: sucursales y terminales.
   *
   * Un comercio aprobado sigue abriendo locales y rotando POS; ese movimiento no toca nada de lo que
   * el analista firmó, así que no tiene por qué morir con la aprobación.
   */
  assertCommercialNetworkEditable(profile: PartnerProfileModel): void {
    if (!COMMERCIAL_NETWORK_EDITABLE_STATUSES.includes(profile.onboardingStatus as (typeof COMMERCIAL_NETWORK_EDITABLE_STATUSES)[number])) {
      throw new UnprocessableEntityException(`PARTNER_NETWORK_NOT_EDITABLE_IN_STATUS: ${profile.onboardingStatus}`);
    }
  }

  /**
   * Igual que `assertEditable`, pero para el QR DE COBRO.
   *
   * El comercio aprobado —el único que de verdad cobra— no podía subir el suyo, así que la app no
   * tenía qué enseñar cuando el cliente pulsaba «pagar». Un QR no se edita: se reemplaza, y el
   * anterior queda archivado apuntando al nuevo, de modo que abrir esta puerta no borra nada de lo
   * que hubo antes.
   */
  assertPaymentQrEditable(profile: PartnerProfileModel): void {
    if (!PAYMENT_QR_EDITABLE_STATUSES.includes(profile.onboardingStatus as (typeof PAYMENT_QR_EDITABLE_STATUSES)[number])) {
      throw new UnprocessableEntityException(`PARTNER_QR_NOT_EDITABLE_IN_STATUS: ${profile.onboardingStatus}`);
    }
  }
  /**
   * Envía el expediente a revisión.
   *
   * No aprueba nada: deja el caso en `under_review`. La aprobación la firma una persona, y que
   * este método no pueda darla es deliberado — un onboarding que se auto-aprueba al completar sus
   * campos es un formulario, no una verificación.
   */
  async submit(tenantId: string, partnerId: string): Promise<{ profile: PartnerProfileModel; gaps: SubmissionGap[] }> {
    const profile = await this.requireProfile(tenantId, partnerId);
    this.assertEditable(profile);

    const gaps = await this.verification.findSubmissionGaps(tenantId, profile);
    if (gaps.length > 0) {
      this.metrics.recordPartnerOnboardingStep({ step: 'submit', outcome: 'rejected' });
      /*
       * Lo que falta se nombra en el mensaje por el mismo motivo, y la lista COMPLETA sigue estando
       * en `GET /status` —que es donde el portal la lee mientras se completa el trámite, no sólo al
       * pulsar «enviar»—. Aquí basta con que quien recibe el 422 sepa qué le falta sin tener que
       * hacer otra llamada para averiguarlo.
       */
      throw new UnprocessableEntityException(`PARTNER_SUBMISSION_INCOMPLETE: faltan ${gaps.map((gap) => gap.requirement).join(', ')}.`);
    }

    const enviado = await this.repository.updateProfile(profile, {
      onboardingStatus: 'under_review',
      submittedAt: new Date(),
    });
    this.metrics.recordPartnerOnboardingStep({ step: 'submit', outcome: 'ok' });
    this.logger.log(`Expediente de partner enviado a revisión: partnerId=${partnerId} tenant=${tenantId}`);

    /*
     * Enviar dispara la verificación, igual que enviar una solicitud de crédito dispara la
     * decisión de crédito. Antes el expediente se quedaba en `under_review` esperando a que alguien
     * se acordara de mirarlo, y quien lo miraba decidía con su propio criterio: la política que
     * habilita a un comercio a cobrar no estaba escrita en ninguna parte.
     */
    const { profile: evaluado } = await this.verification.evaluarConMotor(tenantId, enviado, {
      idempotencyKey: `submit-${enviado.id}`,
    });
    return { profile: evaluado, gaps: [] };
  }
  async decide(
    tenantId: string,
    partnerId: string,
    input: { approved: boolean; rejectionReason?: string; internalUserId: string | null },
  ): Promise<PartnerProfileModel> {
    const profile = await this.requireProfile(tenantId, partnerId);

    if (profile.onboardingStatus !== 'under_review') {
      throw new ConflictException(`PARTNER_NOT_UNDER_REVIEW: el expediente está en ${profile.onboardingStatus}.`);
    }

    /*
     * Con caso abierto en el Motor, la decisión se toma ALLÍ.
     *
     * Es la misma regla que ya gobierna la revisión manual del riesgo
     * (`MANUAL_REVIEW_DELEGADA_AL_MOTOR`): dos bandejas para el mismo expediente producen dos
     * veredictos y gana el que alguien mire primero. Se corta en el servicio y no en la pantalla,
     * porque una pantalla se salta con curl.
     */
    if (profile.manualReviewCaseCode) {
      throw new ConflictException(`PARTNER_DECISION_DELEGADA_AL_MOTOR: el caso ${profile.manualReviewCaseCode} se resuelve en el Motor.`);
    }

    const updated = await this.repository.updateProfile(profile, {
      onboardingStatus: input.approved ? 'approved' : 'rejected',
      decidedAt: new Date(),
      decidedByInternalUserId: input.internalUserId,
      rejectionReason: input.approved ? null : (input.rejectionReason ?? null),
    });

    this.metrics.recordPartnerOnboardingStep({ step: 'decision', outcome: input.approved ? 'ok' : 'rejected' });
    this.logger.log(
      `Expediente de partner decidido: partnerId=${partnerId} resultado=${input.approved ? 'approved' : 'rejected'} ` +
        `actor=${input.internalUserId ?? 'sin-usuario-interno'}`,
    );
    return updated;
  }
}
