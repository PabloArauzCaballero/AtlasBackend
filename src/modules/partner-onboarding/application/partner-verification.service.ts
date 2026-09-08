/**
 * @file Servicio de aplicación: la verificación del expediente del comercio, de punta a punta.
 * @business Reúne qué le falta al expediente, quién lo decide y cómo se enlaza con la cuenta del ERP.
 * @system pide el veredicto al Motor (PARTNER_KYB_REVIEW) y lo aplica al expediente en un solo sitio.
 */
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { MetricsService } from '../../../common/observability/metrics.service.js';
import { PartnerProfileModel } from '../../../database/models/index.js';
import { toPartnerProfileDto } from '../partner-onboarding.mapper.js';
import { PartnerOnboardingRepository } from '../partner-onboarding.repository.js';
import { PartnerKybDecisionService, type KybDecision } from './partner-kyb-decision.service.js';

/** Un requisito que le falta al expediente para poder verificarse. */
export interface SubmissionGap {
  requirement: 'commercial_registry' | 'legal_representative' | 'power_of_attorney' | 'branch' | 'business_qr' | 'bank_qr';
  detail: string;
}

/**
 * Todo lo que rodea a la verificación de un comercio, en un solo servicio.
 *
 * Vivía repartido dentro de `PartnerProfileService`, que hacía además el alta, la evidencia, los
 * QR y la edición del expediente: 648 líneas en las que la pregunta «¿quién decide si este comercio
 * puede cobrar?» estaba mezclada con «¿cómo se sube un poder notarial?». Separarlo no es una
 * cuestión de tamaño: es que la verificación tiene ahora un dueño —el Motor— y conviene que se lea
 * junta, incluido lo que Atlas sigue haciendo alrededor (calcular los huecos, aplicar el veredicto,
 * enlazar con el ERP).
 *
 * **Un solo origen de la decisión.** `evaluarConMotor` la llaman los dos caminos: el envío del
 * propio comercio y `POST /operations/partners/:id/kyb-review`, que usan operaciones y el ERP.
 * Tenerla en una sola función es lo que impide que vuelvan a existir dos formas de decidir lo mismo.
 */
@Injectable()
export class PartnerVerificationService {
  private readonly logger = new Logger(PartnerVerificationService.name);

  constructor(
    private readonly repository: PartnerOnboardingRepository,
    private readonly metrics: MetricsService,
    private readonly kyb: PartnerKybDecisionService,
  ) {}

  private async requireProfile(tenantId: string, partnerId: string): Promise<PartnerProfileModel> {
    const profile = await this.repository.findProfileById(tenantId, partnerId);
    if (!profile) throw new ConflictException(`PARTNER_NOT_FOUND: no existe el expediente ${partnerId}.`);
    return profile;
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
   * Pide al Motor que verifique el expediente y aplica su veredicto.
   *
   * Es UNA sola función y la llaman los dos orígenes —el autoservicio del comercio al enviar, y
   * `POST /operations/partners/:id/kyb-review` que usan operaciones y el ERP—. Tenerla en un solo
   * sitio es lo que impide que vuelvan a existir dos formas de decidir lo mismo.
   *
   * `APROBADO` deja el expediente firmado por el Motor: `decided_by_internal_user_id` queda nulo
   * porque no lo firmó una persona, y la pantalla lo dice. `REVISION_MANUAL` lo deja en
   * `under_review` con el caso del Motor apuntado, que es lo que hace que esta consola deje de
   * ofrecer un segundo formulario.
   */
  async evaluarConMotor(
    tenantId: string,
    profile: PartnerProfileModel,
    options: { idempotencyKey: string },
  ): Promise<{ profile: PartnerProfileModel; decision: KybDecision }> {
    const gaps = await this.findSubmissionGaps(tenantId, profile);
    const branches = await this.repository.listBranches(tenantId, profile.id);
    const decision = await this.kyb.evaluate({
      tenantId,
      profile,
      gaps,
      sucursales: branches.length,
      idempotencyKey: options.idempotencyKey,
    });

    const comun = {
      decisionExecutionId: decision.executionId,
      decisionOutcome: decision.outcome,
      decisionReason: decision.reason,
      decisionArtifactVersion: decision.artifactVersionId,
      manualReviewCaseCode: decision.manualReviewCaseCode,
      decisionEvaluatedAt: decision.evaluatedAt,
    };

    if (decision.outcome === 'APROBADO') {
      const updated = await this.repository.updateProfile(profile, {
        ...comun,
        onboardingStatus: 'approved',
        decidedAt: decision.evaluatedAt,
        // Nulo a propósito: lo firmó el Motor, no una persona, y rellenarlo con el operador que
        // pidió la verificación atribuiría a alguien una decisión que no tomó.
        decidedByInternalUserId: null,
        rejectionReason: null,
      });
      this.metrics.recordPartnerOnboardingStep({ step: 'decision', outcome: 'ok' });
      return { profile: updated, decision };
    }

    if (decision.outcome === 'RECHAZADO') {
      const updated = await this.repository.updateProfile(profile, {
        ...comun,
        onboardingStatus: 'rejected',
        decidedAt: decision.evaluatedAt,
        decidedByInternalUserId: null,
        // El motivo del Motor es lo que el comercio verá y lo que le dice qué corregir.
        rejectionReason: decision.reason,
      });
      this.metrics.recordPartnerOnboardingStep({ step: 'decision', outcome: 'rejected' });
      return { profile: updated, decision };
    }

    // REVISION_MANUAL —o cualquier desenlace que el artefacto añada mañana y este código no
    // conozca—: se queda esperando a una persona. Un desenlace desconocido NUNCA habilita a cobrar.
    const updated = await this.repository.updateProfile(profile, { ...comun, onboardingStatus: 'under_review' });
    return { profile: updated, decision };
  }

  /**
   * La firma de una persona sobre el expediente: aprobado o rechazado.
   *
   * Faltaba, y sin ella el onboarding no llegaba a ninguna parte. `submit` deja el caso en
   * `under_review` a propósito —«un onboarding que se auto-aprueba al completar sus campos es un
   * formulario, no una verificación»—, pero **nada podía moverlo de ahí**: el esquema guardaba
   * `decided_at`, `decided_by_internal_user_id` y `rejection_reason` desde el primer día y no había
   * un solo camino que los escribiera. El resultado era un expediente que nunca quedaba verificado,
   * y por tanto un comercio que nunca podía cobrar.
   *
   * ## Sólo desde `under_review`
   *
   * Aprobar un borrador saltaría la comprobación de completitud que `submit` hace —representante
   * legal, registro comercial, QR de cobro—, y volver a decidir sobre un expediente ya resuelto
   * borraría la primera firma sin dejar constancia de que hubo dos. Quien quiera revertir una
   * decisión abre un caso nuevo, que es lo que deja rastro.
   *
   * ## Rechazar exige motivo
   *
   * Por lo mismo que declinar un crédito: un comercio rechazado sin explicación es el que vuelve a
   * preguntar, y seis meses después nadie sabe qué se miró. Aprobar no lo exige — el motivo es el
   * expediente completo que se acaba de revisar.
   */
  /**
   * Los expedientes que esperan decisión.
   *
   * Es lo que convierte la verificación en una COLA y no en un formulario de búsqueda: antes había
   * que traer el identificador del comercio desde otra pantalla, así que la carga de trabajo
   * pendiente no se veía en ninguna parte.
   */
  async listAwaitingDecision(tenantId: string, query: { page: number; limit: number }) {
    const { rows, count } = await this.repository.findProfilesAwaitingDecision(tenantId, {
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    });
    return {
      items: rows.map(toPartnerProfileDto),
      meta: {
        page: query.page,
        limit: query.limit,
        total: count,
        totalPages: Math.max(1, Math.ceil(count / query.limit)),
      },
    };
  }


  /**
   * Busca el expediente que corresponde a una cuenta del ERP o a un NIT.
   *
   * Devuelve una lista y no un expediente: por NIT puede haber más de uno —un comercio que fue
   * rechazado y volvió a intentarlo—, y decidir cuál es «el bueno» desde aquí sería inventarse una
   * regla que quien pregunta conoce mejor. Vacío es `items: []` con 200, nunca un 404: «esta cuenta
   * todavía no tiene expediente» es una respuesta legítima, no un error.
   */
  async findByExternalKeys(
    tenantId: string,
    query: { erpAccountId?: string; taxId?: string; page: number; limit: number },
  ) {
    const { rows, count } = await this.repository.findProfilesByExternalKeys(
      tenantId,
      { erpAccountId: query.erpAccountId, taxId: query.taxId },
      { limit: query.limit, offset: (query.page - 1) * query.limit },
    );
    return {
      items: rows.map(toPartnerProfileDto),
      meta: {
        page: query.page,
        limit: query.limit,
        total: count,
        totalPages: Math.max(1, Math.ceil(count / query.limit)),
      },
    };
  }

  /**
   * Enlaza el expediente con la cuenta del ERP.
   *
   * De una vía: si ya apunta a otra cuenta, 409. Reescribir el puente convertiría el historial de
   * verificación de un comercio en el de otro, y nada lo delataría después.
   */
  async linkErpAccount(tenantId: string, partnerId: string, erpAccountId: string): Promise<PartnerProfileModel> {
    const profile = await this.requireProfile(tenantId, partnerId);
    if (profile.erpAccountId && profile.erpAccountId !== erpAccountId) {
      throw new ConflictException(
        `PARTNER_ERP_ACCOUNT_ALREADY_LINKED: el expediente ya apunta a la cuenta ${profile.erpAccountId}.`,
      );
    }
    if (profile.erpAccountId === erpAccountId) return profile;
    return this.repository.updateProfile(profile, { erpAccountId });
  }


  /**
   * Pide la verificación de un expediente que ya está en revisión.
   *
   * Existe para los dos casos que el envío del comercio no cubre: el ERP que da de alta la cuenta y
   * quiere la verificación sin esperar a que el comercio pulse nada, y el reintento después de
   * subir lo que faltaba. Sólo desde `under_review`, por lo mismo que `decide`: verificar un
   * borrador saltaría la comprobación de completitud, y volver a verificar un expediente ya
   * resuelto reescribiría una decisión firme sin dejar constancia de que hubo dos.
   */
  async requestKybReview(
    tenantId: string,
    partnerId: string,
    options: { idempotencyKey: string; reason?: string },
  ): Promise<{ profile: PartnerProfileModel; decision: KybDecision }> {
    const profile = await this.requireProfile(tenantId, partnerId);
    if (profile.onboardingStatus !== 'under_review') {
      throw new ConflictException(`PARTNER_NOT_UNDER_REVIEW: el expediente está en ${profile.onboardingStatus}.`);
    }
    this.logger.log(
      `Verificación pedida para el expediente ${partnerId}${options.reason ? `: ${options.reason}` : ''}`,
    );
    return this.evaluarConMotor(tenantId, profile, { idempotencyKey: options.idempotencyKey });
  }

}
