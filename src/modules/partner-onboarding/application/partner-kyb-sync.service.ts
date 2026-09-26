/**
 * @file Servicio de aplicación: trae del Motor la resolución de los casos de verificación de comercios.
 * @business Cierra el circuito: lo que un analista decide en la cola del Motor llega al expediente y habilita (o no) el cobro.
 * @system consulta `GET /v1/manual-reviews/:caseCode` por cada expediente con caso abierto y aplica su veredicto.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
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
      order: [['decision_evaluated_at', 'ASC']],
      limit: input.limit,
    });

    for (const profile of pendientes) {
      resultado.checked += 1;
      const caso = await this.client.getManualReviewCase(profile.manualReviewCaseCode!);
      if (!caso) {
        resultado.unreachable += 1;
        continue;
      }
      const destino = RESUELTOS[caso.status.toUpperCase()];
      if (!destino) {
        resultado.pending += 1;
        continue;
      }
      if (destino === 'cancelled') {
        /*
         * Un caso cancelado NO es un rechazo: es «este caso no era el camino». El expediente vuelve
         * a estar sin caso y la decisión manual local vuelve a estar disponible, que es justo la
         * degradación para la que existe. Tratarlo como rechazo condenaría al comercio por un
         * problema administrativo del que no es responsable.
         */
        await profile.update({ manualReviewCaseCode: null, updatedAtValue: new Date() });
        resultado.cancelled += 1;
        continue;
      }

      const motivo = motivoDeLaResolucion(caso.resolution);
      await profile.update({
        onboardingStatus: destino,
        decidedAt: caso.resolvedAt ? new Date(caso.resolvedAt) : new Date(),
        // Nulo: lo firmó una persona, pero en el Motor. Poner aquí un usuario interno de Atlas
        // atribuiría la decisión a alguien de este lado que no la tomó. Quién la firmó consta en el
        // caso, que es donde ocurrió.
        decidedByInternalUserId: null,
        rejectionReason: destino === 'rejected' ? motivo : null,
        decisionOutcome: destino === 'approved' ? 'APROBADO' : 'RECHAZADO',
        decisionReason: motivo ?? profile.decisionReason,
        updatedAtValue: new Date(),
      });
      resultado[destino] += 1;
      this.logger.log(`Expediente ${profile.id} resuelto en el Motor (${caso.caseCode}): ${destino}.`);
    }

    return resultado;
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
