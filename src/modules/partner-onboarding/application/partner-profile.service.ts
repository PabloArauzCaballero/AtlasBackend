/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un comercio declarado en un partner verificable, con locales, cobro y terminales trazables.
 * @system abre el expediente del partner, comprueba lo que exige el envío y publica su estado.
 */
import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { MetricsService } from '../../../common/observability/metrics.service.js';
import { EDITABLE_PARTNER_STATUSES, PartnerOnboardingRepository } from '../partner-onboarding.repository.js';
import { LegalRepresentativeDto, StartPartnerOnboardingDto } from '../partner-onboarding.schemas.js';
import { PartnerProfileModel } from '../../../database/models/index.js';

/** Lo que el expediente tiene que reunir antes de poder enviarse a revisión. */
export interface SubmissionGap {
  readonly requirement: string;
  readonly detail: string;
}

@Injectable()
export class PartnerProfileService {
  private readonly logger = new Logger(PartnerProfileService.name);

  constructor(
    private readonly repository: PartnerOnboardingRepository,
    private readonly metrics: MetricsService,
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
  async start(tenantId: string, dto: StartPartnerOnboardingDto): Promise<PartnerProfileModel> {
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
   * Qué le falta al expediente para poder enviarse.
   *
   * Devuelve la lista COMPLETA de lo que falta y no el primer fallo: quien está completando un
   * expediente necesita saber cuánto le queda, y descubrirlo de uno en uno convierte el trámite en
   * una sucesión de intentos rechazados.
   */
  async findSubmissionGaps(tenantId: string, profile: PartnerProfileModel): Promise<SubmissionGap[]> {
    const gaps: SubmissionGap[] = [];

    if (!profile.commercialRegistry) {
      gaps.push({ requirement: 'commercial_registry', detail: 'Falta la matrícula de comercio.' });
    }

    const representatives = await this.repository.listRepresentatives(tenantId, profile.id);
    if (representatives.length === 0) {
      gaps.push({ requirement: 'legal_representative', detail: 'Falta declarar al representante legal.' });
    } else if (!representatives.some((item) => item.powerOfAttorneyKey)) {
      // Declarar al representante no es acreditarlo: sin el poder, la representación es una
      // afirmación que hace la propia empresa sobre sí misma.
      gaps.push({ requirement: 'power_of_attorney', detail: 'Falta el poder que acredita al representante legal.' });
    }

    const branches = await this.repository.listBranches(tenantId, profile.id);
    if (branches.length === 0) {
      gaps.push({ requirement: 'branch', detail: 'Falta registrar al menos una sucursal.' });
    }

    const qrCodes = await this.repository.listQrCodes(tenantId, profile.id);
    const live = qrCodes.filter((qr) => qr.status === 'pending_review' || qr.status === 'active');
    if (!live.some((qr) => qr.qrKind === 'business')) {
      gaps.push({ requirement: 'business_qr', detail: 'Falta subir el QR del negocio.' });
    }
    if (!live.some((qr) => qr.qrKind === 'bank')) {
      gaps.push({ requirement: 'bank_qr', detail: 'Falta subir el QR bancario de cobro.' });
    }

    return gaps;
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

    const gaps = await this.findSubmissionGaps(tenantId, profile);
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

    const updated = await this.repository.updateProfile(profile, {
      onboardingStatus: 'under_review',
      submittedAt: new Date(),
    });
    this.metrics.recordPartnerOnboardingStep({ step: 'submit', outcome: 'ok' });
    this.logger.log(`Expediente de partner enviado a revisión: partnerId=${partnerId} tenant=${tenantId}`);
    return { profile: updated, gaps: [] };
  }
}
