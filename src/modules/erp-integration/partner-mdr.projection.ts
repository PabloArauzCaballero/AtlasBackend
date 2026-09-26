/**
 * @file Puerto de persistencia: aplica en Core el MDR efectivo que el ERP publica (T-10 · §1.2).
 * @business El ERP es la autoridad del término comercial (contrato, regla por banda de riesgo); Core
 *   sólo proyecta lo YA pactado en `partner_profiles.mdr_rate_percent`, que es lo que el portal del
 *   comercio muestra. El 3.00 % fijo de la migración `20260825210000` muere el día que este avance
 *   entra en producción: a partir de entonces, o hay un aviso aplicado, o el portal debe marcar la
 *   tarifa como pendiente de contrato — nunca inventar un número (esa parte es del frontend/§1.2).
 * @system UPDATE condicional por `mdr_rate_effective_at` (migración `20260926090000`): un aviso con
 *   `effectiveAt` igual o más viejo que el ya aplicado no pisa el valor vigente, aunque su versión de
 *   agregado (`external_aggregate_versions`, comprobada ANTES de llegar aquí por
 *   `ErpEventInboxService.advanceVersion`) haya avanzado. Doble guarda a propósito: la versión del
 *   sobre ordena la ENTREGA; `effectiveAt` es el dato de negocio que decide cuál vigencia gana, igual
 *   que `recovery_version` hace lo mismo por su cuenta en `InstallmentCoverageProjection`.
 */
import { Logger } from '@nestjs/common';
import { QueryTypes, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import type { MdrUpdatedPayload } from './integration-envelope.schemas.js';

const PARTNER_PROFILES = `${atlasSchemaFor('partner_profiles')}.partner_profiles`;

export class PartnerMdrProjection {
  private readonly logger = new Logger(PartnerMdrProjection.name);

  constructor(private readonly sequelize: Sequelize) {}

  /**
   * Devuelve `true` si el comercio existe EN ESE TENANT (se haya escrito o no un valor más nuevo);
   * `false` si `partnerProfileId` no resuelve a ningún comercio de `tenantId` — nunca lanza: un
   * comercio que Core no conoce (aún no replicado, un id que el ERP tecleó mal, o un sobre sin
   * `tenantId` porque el ERP no lo mandó) se registra como UNLINKED y sigue, no tumba el resto de
   * la entrega del ERP ni escribe a ciegas en el tenant equivocado.
   */
  async applyMdrUpdate(payload: MdrUpdatedPayload, tenantId: string | null, transaction: Transaction): Promise<boolean> {
    if (!tenantId) {
      this.logger.warn(`MDR_UPDATE_WITHOUT_TENANT: partnerProfileId=${payload.partnerProfileId} el sobre no traía tenantId.`);
      return false;
    }
    const applied = await this.sequelize.query<{ id: string }>(
      `UPDATE ${PARTNER_PROFILES}
          SET mdr_rate_percent = $mdrRatePercent::numeric,
              mdr_rate_effective_at = $effectiveAt::timestamptz,
              _updated_at = now()
        WHERE _tenant_id = $tenantId::bigint
          AND _id = $partnerProfileId::bigint
          AND (mdr_rate_effective_at IS NULL OR mdr_rate_effective_at < $effectiveAt::timestamptz)
        RETURNING _id::text AS id`,
      {
        type: QueryTypes.SELECT,
        transaction,
        bind: {
          tenantId,
          partnerProfileId: payload.partnerProfileId,
          mdrRatePercent: payload.mdrRatePercent,
          effectiveAt: payload.effectiveAt,
        },
      },
    );
    if (applied.length === 1) return true;

    // El UPDATE no tocó ninguna fila: o el comercio no existe en ESE tenant, o SÍ existe y el aviso
    // llegó viejo (idempotencia — nada que aplicar, pero no es un comercio sin vincular).
    const exists = await this.sequelize.query<{ id: string }>(
      `SELECT _id::text AS id FROM ${PARTNER_PROFILES} WHERE _tenant_id = $tenantId::bigint AND _id = $partnerProfileId::bigint`,
      { type: QueryTypes.SELECT, transaction, bind: { tenantId, partnerProfileId: payload.partnerProfileId } },
    );
    if (exists.length === 0) {
      this.logger.warn(`MDR_PARTNER_NOT_FOUND: tenantId=${tenantId} partnerProfileId=${payload.partnerProfileId}`);
      return false;
    }
    this.logger.warn(
      `MDR_UPDATE_STALE_OR_REPEATED: partnerProfileId=${payload.partnerProfileId} effectiveAt=${payload.effectiveAt} ` +
        'no es más nuevo que el MDR ya aplicado; se descarta sin pisar el valor vigente.',
    );
    return true;
  }
}
