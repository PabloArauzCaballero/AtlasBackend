/**
 * @file Puerto de persistencia: la proyección en Core de la cobertura que el ERP pagó por una cuota.
 * @business Core es la fuente de la cuota y de sus pagos; el ERP, de la cobertura y la recuperación
 *   (tabla §2.1 del plan). Core NO cambia la cuota ni su saldo cuando ATLAS cubre: registra el hecho
 *   —cuánto cubrió, cuándo, cuánto se recuperó— para que se pueda consultar junto al préstamo.
 * @system `installment_coverage_projections`, una fila por CxC de recuperación del ERP. La liquidación
 *   y los movimientos de recuperación son agregados distintos en el ERP y pueden llegar en cualquier
 *   orden entre sí: cada uno rellena SUS columnas con un upsert; los movimientos sólo avanzan si su
 *   versión es mayor que la guardada.
 */
import { QueryTypes, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import type { CoreRef, CoverageSettledPayload, RecoveryMovementPayload } from './integration-envelope.schemas.js';

const PROJECTION = `${atlasSchemaFor('installment_coverage_projections')}.installment_coverage_projections`;
const INSTALLMENTS = `${atlasSchemaFor('loan_installments')}.loan_installments`;

export type CoverageProjectionRow = {
  erp_recovery_id: string;
  tenant_id: string | null;
  loan_id: string | null;
  installment_id: string | null;
  amount_covered: string | null;
  amount_recovered: string;
  currency_code: string | null;
  coverage_paid_at: Date | null;
  recovery_status: string;
  recovery_version: string;
};

export class InstallmentCoverageProjection {
  constructor(private readonly sequelize: Sequelize) {}

  /**
   * La identidad común sólo cuenta si la cuota EXISTE en Core para ese tenant y préstamo: una
   * referencia que no resuelve se guarda sin ella (UNLINKED) en vez de atribuir la cobertura a otra.
   */
  private async resolve(coreRef: CoreRef | null, transaction: Transaction): Promise<CoreRef | null> {
    if (!coreRef) return null;
    const rows = await this.sequelize.query<{ id: string }>(
      `SELECT _id AS id FROM ${INSTALLMENTS}
        WHERE _tenant_id = $tenantId AND _id = $installmentId AND loan_id = $loanId AND _deleted = false`,
      {
        type: QueryTypes.SELECT,
        transaction,
        bind: { tenantId: coreRef.tenantId, installmentId: coreRef.installmentId, loanId: coreRef.loanId },
      },
    );
    return rows.length === 1 ? coreRef : null;
  }

  /** Devuelve `true` si la cobertura quedó ligada a una cuota de Core. */
  async applySettlement(eventKey: string, payload: CoverageSettledPayload, transaction: Transaction): Promise<boolean> {
    const ref = await this.resolve(payload.coreRef, transaction);
    await this.sequelize.query(
      `INSERT INTO ${PROJECTION}
         (erp_recovery_id, _tenant_id, loan_id, installment_id, partner_profile_id, erp_installment_id, erp_payable_id,
          settlement_reference, amount_covered, currency_code, coverage_paid_at, settled_event_key)
       VALUES ($recoveryId, $tenantId, $loanId, $installmentId, $partnerProfileId, $erpInstallmentId, $payableId,
               $settlementReference, $amount, $currency, $paidAt, $eventKey)
       ON CONFLICT (erp_recovery_id) DO UPDATE SET
         _tenant_id = COALESCE(${PROJECTION}._tenant_id, EXCLUDED._tenant_id),
         loan_id = COALESCE(${PROJECTION}.loan_id, EXCLUDED.loan_id),
         installment_id = COALESCE(${PROJECTION}.installment_id, EXCLUDED.installment_id),
         partner_profile_id = COALESCE(${PROJECTION}.partner_profile_id, EXCLUDED.partner_profile_id),
         erp_payable_id = EXCLUDED.erp_payable_id,
         settlement_reference = EXCLUDED.settlement_reference,
         amount_covered = EXCLUDED.amount_covered,
         currency_code = EXCLUDED.currency_code,
         coverage_paid_at = EXCLUDED.coverage_paid_at,
         settled_event_key = EXCLUDED.settled_event_key,
         _updated_at = now()`,
      {
        transaction,
        bind: {
          recoveryId: payload.recoveryId,
          tenantId: ref?.tenantId ?? null,
          loanId: ref?.loanId ?? null,
          installmentId: ref?.installmentId ?? null,
          partnerProfileId: ref?.partnerProfileId ?? null,
          erpInstallmentId: payload.installmentId,
          payableId: payload.payableId,
          settlementReference: payload.settlementReference,
          amount: payload.amount,
          currency: payload.currency,
          paidAt: payload.paidAt,
          eventKey,
        },
      },
    );
    return ref !== null;
  }

  /** Devuelve `true` si la recuperación está ligada a una cuota de Core. */
  async applyRecoveryMovement(payload: RecoveryMovementPayload, version: number, transaction: Transaction): Promise<boolean> {
    const ref = await this.resolve(payload.coreRef, transaction);
    await this.sequelize.query(
      `INSERT INTO ${PROJECTION}
         (erp_recovery_id, _tenant_id, loan_id, installment_id, partner_profile_id, erp_installment_id,
          amount_recovered, currency_code, recovery_status, recovery_version)
       VALUES ($recoveryId, $tenantId, $loanId, $installmentId, $partnerProfileId, $erpInstallmentId,
               $amountRecovered, $currency, $status, $version)
       ON CONFLICT (erp_recovery_id) DO UPDATE SET
         _tenant_id = COALESCE(${PROJECTION}._tenant_id, EXCLUDED._tenant_id),
         loan_id = COALESCE(${PROJECTION}.loan_id, EXCLUDED.loan_id),
         installment_id = COALESCE(${PROJECTION}.installment_id, EXCLUDED.installment_id),
         amount_recovered = EXCLUDED.amount_recovered,
         recovery_status = EXCLUDED.recovery_status,
         recovery_version = EXCLUDED.recovery_version,
         _updated_at = now()
       WHERE ${PROJECTION}.recovery_version < EXCLUDED.recovery_version`,
      {
        transaction,
        bind: {
          recoveryId: payload.recoveryId,
          tenantId: ref?.tenantId ?? null,
          loanId: ref?.loanId ?? null,
          installmentId: ref?.installmentId ?? null,
          partnerProfileId: ref?.partnerProfileId ?? null,
          erpInstallmentId: payload.installmentId,
          amountRecovered: payload.amountRecovered,
          currency: payload.currency,
          status: payload.recoveryStatus,
          version,
        },
      },
    );
    return ref !== null;
  }

  /** Lectura consultable: la cobertura que el ERP pagó para las cuotas de un préstamo de Core. */
  async forLoan(input: { tenantId: string; loanId: string }): Promise<CoverageProjectionRow[]> {
    return this.sequelize.query<CoverageProjectionRow>(
      `SELECT erp_recovery_id, _tenant_id::text AS tenant_id, loan_id::text AS loan_id, installment_id::text AS installment_id,
              amount_covered::text AS amount_covered, amount_recovered::text AS amount_recovered, currency_code,
              coverage_paid_at, recovery_status, recovery_version::text AS recovery_version
         FROM ${PROJECTION}
        WHERE _tenant_id = $tenantId AND loan_id = $loanId
        ORDER BY installment_id, erp_recovery_id`,
      { type: QueryTypes.SELECT, bind: input },
    );
  }
}
