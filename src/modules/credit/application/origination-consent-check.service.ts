/**
 * @file Servicio de aplicación: el core no origina sobre un consentimiento retirado (P-09, B12).
 * @business Una revocación bloquea las originaciones que dependen de ella aunque el motor esté caído.
 * @system lee el consentimiento donde vive —aquí— y la cola de réplica al motor, dentro de la transacción de la concesión.
 */
import { ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, type Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { atlasSchemaFor } from '../../../database/domain-schemas.js';

type ConsentFacts = { missing_required: string; revoked_after_decision: string; pending_revocations: string };

/**
 * El control que el motor no puede ejercer si no se entera.
 *
 * El consentimiento vive en el core: aquí se otorga y aquí se revoca. El motor recibe una RÉPLICA
 * para poder negarse a decidir con un permiso retirado, y esa réplica puede llegar tarde —el motor
 * estaba caído al revocar— o no llegar. Mientras tanto una decisión aprobada antes de la revocación
 * seguiría siendo desembolsable. Esta comprobación cierra ese hueco en el punto donde se entrega el
 * dinero, sin depender del motor:
 *
 * - `CONSENT_REVOCATION_PENDING_SYNC`: hay una revocación del cliente que el motor todavía no acusó.
 * - `CONSENT_REVOKED_AFTER_DECISION`: el cliente revocó un consentimiento DESPUÉS de la decisión que
 *   se quiere desembolsar; esa decisión se tomó con un permiso que ya no existe.
 * - `REQUIRED_CONSENT_MISSING`: falta (o se revocó) un documento obligatorio del tenant, el mismo
 *   criterio que ya exige la admisión.
 *
 * Es deliberadamente amplio (cualquier revocación posterior a la decisión bloquea): qué finalidades
 * condicionan qué originación lo ratifica Legal/Privacidad (docs/compliance/decisions.md, P-09).
 */
@Injectable()
export class OriginationConsentCheck {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async assertMayOriginate(
    input: { tenantId: string; customerId: string; decidedAt: Date | null },
    transaction?: Transaction,
  ): Promise<void> {
    const privacy = atlasSchemaFor('customer_consents');
    const replications = `${atlasSchemaFor('decision_consent_replications')}.decision_consent_replications`;
    const rows = await this.sequelize.query<ConsentFacts>(
      `SELECT
         (SELECT count(*) FROM ${atlasSchemaFor('consent_documents')}.consent_documents d
           WHERE d._tenant_id = $tenantId AND d.status = 'published' AND d.requires_explicit_action = true
             AND NOT EXISTS (
               SELECT 1 FROM ${privacy}.customer_consents c
                WHERE c._tenant_id = $tenantId AND c.customer_id = $customerId AND c.consent_document_id = d._id
                  AND c.granted = true AND c.revoked_at IS NULL))::text AS missing_required,
         (SELECT count(*) FROM ${privacy}.customer_consents c
           WHERE c._tenant_id = $tenantId AND c.customer_id = $customerId
             AND c.revoked_at IS NOT NULL AND c.revoked_at >= $decidedAt)::text AS revoked_after_decision,
         (SELECT count(*) FROM ${replications} r
           WHERE r._tenant_id = $tenantId AND r.customer_id = $customerId
             AND r.action = 'revoke' AND r.status = 'pending')::text AS pending_revocations`,
      {
        type: QueryTypes.SELECT,
        // Sin fecha de decisión no hay «antes»: cualquier revocación cuenta.
        bind: { tenantId: input.tenantId, customerId: input.customerId, decidedAt: input.decidedAt ?? new Date(0) },
        transaction,
      },
    );
    const facts = rows[0] ?? { missing_required: '0', revoked_after_decision: '0', pending_revocations: '0' };
    if (Number(facts.pending_revocations) > 0) throw new ConflictException('CONSENT_REVOCATION_PENDING_SYNC');
    if (Number(facts.revoked_after_decision) > 0) throw new ConflictException('CONSENT_REVOKED_AFTER_DECISION');
    if (Number(facts.missing_required) > 0) throw new ConflictException('REQUIRED_CONSENT_MISSING');
  }
}
