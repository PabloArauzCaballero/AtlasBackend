/**
 * @file Servicio de aplicación: trae del Motor la resolución de los casos de verificación de comercios.
 * @business Cierra el circuito: lo que un analista decide en la cola del Motor llega al expediente y habilita (o no) el cobro.
 * @system consulta `GET /v1/manual-reviews/:caseCode` por cada expediente con caso abierto y aplica su veredicto.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type WhereOptions } from 'sequelize';
import { PartnerProfileModel } from '../../../database/models/index.js';
import { DecisionEngineClient } from '../../decision-engine/decision-engine.client.js';

/** Los estados del caso que YA son un veredicto. El resto sigue esperando a una persona. */
const RESUELTOS: Record<string, 'approved' | 'rejected' | 'cancelled'> = {
  RESOLVED_APPROVED: 'approved',
  RESOLVED_DECLINED: 'rejected',
  CANCELLED: 'cancelled',
};

export type PartnerKybSyncResult = {
  checked: number;
  approved: number;
  rejected: number;
  cancelled: number;
  pending: number;
  unreachable: number;
};

/**
 * La vuelta del circuito, que faltaba entera.
 *
 * El Motor abre el caso y una persona lo resuelve EN SU COLA —que es donde debe resolverse, porque
 * es donde está la traza de la ejecución que lo abrió—. Pero el expediente vive en Atlas: es lo
 * que hace que un QR de caja resuelva y que una venta pueda atribuirse. Sin esta sincronización,
 * un comercio aprobado por un analista en el Motor seguía figurando «en revisión» aquí para
 * siempre, y nadie lo notaba porque las dos pantallas decían la verdad de su propio lado.
 *
 * Va por tirón y no por webhook a propósito: un webhook del Motor hacia Atlas exigiría exponer una
 * entrada nueva, autenticarla y aguantar reintentos, para un evento que ocurre unas pocas veces al
 * día y cuyo retraso máximo aceptable se mide en minutos. Tirar es más simple y falla mejor: si el
 * Motor no responde, la pasada siguiente lo intenta y nada se pierde.
 */
@Injectable()
export class PartnerKybSyncService {
  private readonly logger = new Logger(PartnerKybSyncService.name);

  constructor(
    @InjectModel(PartnerProfileModel) private readonly profileModel: typeof PartnerProfileModel,
    private readonly client: DecisionEngineClient,
  ) {}

  async syncPendingReviews(input: { tenantId: string; limit: number }): Promise<PartnerKybSyncResult> {
    const resultado: PartnerKybSyncResult = { checked: 0, approved: 0, rejected: 0, cancelled: 0, pending: 0, unreachable: 0 };
    if (!this.client.isConfigured) return resultado;

    const pendientes = await this.profileModel.findAll({
      where: {
        tenantId: input.tenantId,
        onboardingStatus: 'under_review',
        manualReviewCaseCode: { [Op.ne]: null },
        deleted: false,
      },
      /*
       * Por la última vez que se miró, y no por la antigüedad del caso. Ordenado por
       * `decision_evaluated_at`, los casos que siguen abiertos (o que el Motor ya no reconoce) eran
       * SIEMPRE los primeros: con tantos como el límite, la pasada sólo veía esos y un comercio
       * aprobado después no llegaba nunca a `approved`. Cada consulta sin veredicto toca
       * `_updated_at` (ver `marcarConsultado`), así que el expediente pasa al final de la cola.
       */
      order: [['_updated_at', 'ASC NULLS FIRST']],
      limit: input.limit,
    });

    for (const profile of pendientes) {
      resultado.checked += 1;
      const caso = await this.client.getManualReviewCase(profile.manualReviewCaseCode!);
      if (!caso) {
        resultado.unreachable += 1;
        await this.marcarConsultado(profile);
        continue;
      }
      const destino = RESUELTOS[caso.status.toUpperCase()];
      if (!destino) {
        resultado.pending += 1;
        await this.marcarConsultado(profile);
        continue;
      }
      if (destino === 'cancelled') {
        /*
         * Un caso cancelado NO es un rechazo: es «este caso no era el camino». El expediente vuelve
         * a estar sin caso y la decisión manual local vuelve a estar disponible, que es justo la
         * degradación para la que existe. Tratarlo como rechazo condenaría al comercio por un
         * problema administrativo del que no es responsable.
         */
        if (await this.escribirSiSigueIgual(profile, { manualReviewCaseCode: null })) resultado.cancelled += 1;
        continue;
      }

      const motivo = motivoDeLaResolucion(caso.resolution);
      const escrito = await this.escribirSiSigueIgual(profile, {
        onboardingStatus: destino,
        decidedAt: caso.resolvedAt ? new Date(caso.resolvedAt) : new Date(),
        // Nulo: lo firmó una persona, pero en el Motor. Poner aquí un usuario interno de Atlas
        // atribuiría la decisión a alguien de este lado que no la tomó. Quién la firmó consta en el
        // caso, que es donde ocurrió.
        decidedByInternalUserId: null,
        rejectionReason: destino === 'rejected' ? motivo : null,
        decisionOutcome: destino === 'approved' ? 'APROBADO' : 'RECHAZADO',
        decisionReason: motivo ?? profile.decisionReason,
      });
      if (!escrito) continue;
      resultado[destino] += 1;
      this.logger.log(`Expediente ${profile.id} resuelto en el Motor (${caso.caseCode}): ${destino}.`);
    }

    return resultado;
  }

  /**
   * Escribe sólo si el expediente sigue en revisión con el MISMO caso que se consultó.
   *
   * Entre la lectura y la escritura hay una llamada HTTP al Motor; si en ese hueco el expediente se
   * decidió por otro camino, escribir sobre la instancia leída pisaba esa decisión (un `rejected`
   * vuelto `approved`). El UPDATE condicional hace la comprobación y la escritura en una sola
   * sentencia: si ya no casa, no escribe nada y lo resolverá quien lo cambió.
   */
  private async escribirSiSigueIgual(profile: PartnerProfileModel, values: Record<string, unknown>): Promise<boolean> {
    const where: WhereOptions = {
      id: profile.id,
      tenantId: profile.tenantId,
      onboardingStatus: 'under_review',
      manualReviewCaseCode: profile.manualReviewCaseCode,
      deleted: false,
    };
    const [filas] = await this.profileModel.update({ ...values, updatedAtValue: new Date() }, { where });
    if (filas === 0) {
      this.logger.warn(`Expediente ${profile.id} cambió mientras se consultaba su caso en el Motor; no se reescribe.`);
      return false;
    }
    return true;
  }

  /** Un caso consultado sin veredicto pasa al final de la cola de la próxima pasada. */
  private async marcarConsultado(profile: PartnerProfileModel): Promise<void> {
    await this.escribirSiSigueIgual(profile, {});
  }
}

/**
 * El motivo escrito por quien resolvió. Se busca en varios nombres porque la resolución del Motor
 * es JSON libre: lo que no se puede es dejar un rechazo sin explicación, que es lo que el comercio
 * necesita para saber qué corregir.
 */
function motivoDeLaResolucion(resolution: Record<string, unknown> | null): string | null {
  if (!resolution) return null;
  const bruto = resolution.reason ?? resolution.motivo ?? resolution.comments ?? resolution.notes;
  return bruto ? String(bruto).slice(0, 200) : null;
}
