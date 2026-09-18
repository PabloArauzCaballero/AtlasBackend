/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un comercio declarado en un partner verificable, con locales, cobro y terminales trazables.
 * @system abre el expediente del partner, comprueba lo que exige el envío y publica su estado.
 */
import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { MetricsService } from '../../../common/observability/metrics.service.js';
import { PartnerCommercialNetworkRepository } from '../partner-commercial-network.repository.js';
import { PartnerOnboardingRepository } from '../partner-onboarding.repository.js';
import { StartPartnerOnboardingDto, UpdateCommercialProfileDto } from '../partner-onboarding.schemas.js';
import { PartnerProfileModel } from '../../../database/models/index.js';
import { ExpedienteHooksService } from '../../expedientes/application/expediente-hooks.service.js';
import { PartnerVerificationService, type SubmissionGap } from './partner-verification.service.js';
import { assertCommercialNetworkEditable, assertEditable } from './partner-profile.guards.js';

/**
 * El perfil del comercio: abrirlo, corregir su ficha, enviarlo y decidirlo. Lo que sube (poder,
 * QR) vive en `PartnerRepresentativeService` y `PartnerQrService`.
 */
@Injectable()
export class PartnerProfileService {
  private readonly logger = new Logger(PartnerProfileService.name);

  constructor(
    private readonly repository: PartnerOnboardingRepository,
    private readonly network: PartnerCommercialNetworkRepository,
    private readonly metrics: MetricsService,
    private readonly verification: PartnerVerificationService,
    private readonly expedienteHooks: ExpedienteHooksService,
  ) {}

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

    /*
     * La carpeta de archivos del comercio (Operaciones › Archivos) nace aquí porque éste es el ÚNICO
     * sitio donde se crea `partner_profiles`: el portal del negocio y el ERP pasan ambos por `start`.
     * Rótulo: el nombre comercial —lo que un operador reconoce— o, si no lo declaró, «NIT <tax_id>»,
     * el único dato que siempre está y es único por tenant. El gancho no puede tumbar el alta.
     */
    await this.expedienteHooks.alCrearComercio({
      tenantId,
      partnerId: profile.id,
      customerCode: profile.tradeName?.trim() || `NIT ${profile.taxId}`,
    });
    return profile;
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
    assertEditable(profile);
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
    assertCommercialNetworkEditable(profile);

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
   * Fija la comisión del comercio. Es un término comercial, no un dato de identidad, así que se puede
   * ajustar en cualquier momento —también con el expediente ya aprobado—: lo negocia Atlas, no lo
   * declara el comercio, y por eso vive detrás de una ruta interna y no del portal del negocio.
   */
  async setMdrRate(tenantId: string, partnerId: string, mdrRatePercent: number) {
    const profile = await this.requireProfile(tenantId, partnerId);
    return this.repository.updateProfile(profile, { mdrRatePercent: mdrRatePercent.toFixed(2) });
  }

  async requireProfile(tenantId: string, partnerId: string): Promise<PartnerProfileModel> {
    const profile = await this.repository.findProfileById(tenantId, partnerId);
    if (!profile) throw new NotFoundException('Expediente de partner no encontrado.');
    return profile;
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
    assertEditable(profile);

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

    // El veredicto va en las MISMAS columnas que rellena el Motor, con procedencia `DECISION_MANUAL_PORTAL`:
    // es lo que lee el ERP para activar (su compuerta exige `APROBADO`). Sin esto la degradación dejaba
    // el expediente `approved` aquí y el caso del ERP imposible de activar. `decision_execution_id` no se
    // toca: aquí no hubo ejecución.
    const decidedAt = new Date();
    const updated = await this.repository.updateProfile(profile, {
      onboardingStatus: input.approved ? 'approved' : 'rejected',
      decidedAt,
      decidedByInternalUserId: input.internalUserId,
      rejectionReason: input.approved ? null : (input.rejectionReason ?? null),
      decisionOutcome: input.approved ? 'APROBADO' : 'RECHAZADO',
      decisionReason: input.approved ? 'DECISION_MANUAL_PORTAL' : (input.rejectionReason ?? 'DECISION_MANUAL_PORTAL'),
      decisionEvaluatedAt: decidedAt,
    });

    this.metrics.recordPartnerOnboardingStep({ step: 'decision', outcome: input.approved ? 'ok' : 'rejected' });
    this.logger.log(
      `Expediente de partner decidido: partnerId=${partnerId} resultado=${input.approved ? 'approved' : 'rejected'} ` +
        `actor=${input.internalUserId ?? 'sin-usuario-interno'}`,
    );
    return updated;
  }
}
