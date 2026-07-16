import { NotFoundException } from '@nestjs/common';
import { boolValue, clean, id, intValue, iso, jsonValue, nullableText, policyId, Row, splitPolicyId } from './portal-format.util.js';
import { NOW_SEED } from './portal-report-definitions.js';
import { PortalQueryBase } from './portal-query.base.js';

/**
 * Políticas de gobierno del portal interno: propósitos de privacidad, retención, clasificación,
 * campos sensibles y reglas de calidad, unificadas bajo un `policyId` con prefijo por tipo.
 *
 * Extraído de `internal-portal.service.ts` (Fase 2.2 del plan 10/10) sin cambios de comportamiento.
 */
export class PortalGovernanceService extends PortalQueryBase {
  async getGovernancePolicy(policyIdValue: string) {
    const { kind, rawId } = splitPolicyId(policyIdValue);
    const candidates = await this.findPolicyCandidates(rawId, kind);
    const policy = candidates[0];
    if (!policy) throw new NotFoundException('GOVERNANCE_POLICY_NOT_FOUND');
    return policy;
  }

  async updateGovernancePolicy(policyIdValue: string, body: Row) {
    const existing = await this.getGovernancePolicy(policyIdValue);
    return {
      ...existing,
      ...this.bodyToPolicyOverlay(body),
      metadata: {
        ...jsonValue(existing.metadata),
        lastUpdate: body,
        persisted: false,
        note: 'Configuración recibida y validada por contrato de portal; aplicar persistencia granular por tipo de política si se requiere gobierno editable.',
      },
      updatedAt: new Date().toISOString(),
    };
  }

  private bodyToPolicyOverlay(body: Row): Row {
    return {
      name: nullableText(body.name) ?? undefined,
      description: nullableText(body.description) ?? undefined,
      owner: nullableText(body.owner) ?? undefined,
      status: nullableText(body.status) ?? undefined,
      policyType: nullableText(body.policyType) ?? undefined,
      version: nullableText(body.version) ?? undefined,
    };
  }

  private async findPolicyCandidates(rawId: string, kind: string | null) {
    const candidates: Array<Row> = [];
    if (!kind || kind === 'purpose') {
      const rows = await this.queryRows(
        `SELECT _id, purpose_code, purpose_name, legal_basis, description, requires_explicit_consent, is_active, _updated_at FROM privacy_processing_purposes WHERE _id::text = :id OR purpose_code = :id LIMIT 1`,
        { id: rawId },
      );
      candidates.push(
        ...rows.map((row) => ({
          policyId: policyId('purpose', row._id),
          key: clean(row.purpose_code),
          name: clean(row.purpose_name),
          policyType: 'PRIVACY_PURPOSE',
          status: boolValue(row.is_active, true) ? 'ACTIVE' : 'INACTIVE',
          version: 'v1',
          owner: 'compliance',
          description: clean(row.description),
          effectiveFrom: NOW_SEED,
          effectiveUntil: null,
          affectedTables: ['customers', 'customer_consents'],
          affectedColumns: [],
          controls: [
            {
              controlId: `consent:${id(row._id)}`,
              controlType: 'CONSENT',
              label: clean(row.legal_basis),
              status: boolValue(row.requires_explicit_consent, false) ? 'REQUIRED' : 'DOCUMENTED',
              config: { explicitConsent: boolValue(row.requires_explicit_consent) },
            },
          ],
          actions: this.defaultPolicyActions(),
          approvals: [],
          metadata: { legalBasis: clean(row.legal_basis) },
          updatedAt: iso(row._updated_at) ?? NOW_SEED,
        })),
      );
    }
    if (!kind || kind === 'retention') {
      const rows = await this.queryRows(
        `SELECT _id, policy_code, applies_to, retention_days, post_retention_action, legal_basis, description, is_active, _updated_at FROM retention_policies WHERE _id::text = :id OR policy_code = :id LIMIT 1`,
        { id: rawId },
      );
      candidates.push(
        ...rows.map((row) => ({
          policyId: policyId('retention', row._id),
          key: clean(row.policy_code),
          name: `Retención ${clean(row.applies_to)}`,
          policyType: 'RETENTION',
          status: boolValue(row.is_active, true) ? 'ACTIVE' : 'INACTIVE',
          version: 'v1',
          owner: 'data-governance',
          description: clean(row.description),
          effectiveFrom: NOW_SEED,
          effectiveUntil: null,
          affectedTables: [clean(row.applies_to)],
          affectedColumns: [],
          controls: [
            {
              controlId: `retention:${id(row._id)}`,
              controlType: 'RETENTION_DAYS',
              label: `${intValue(row.retention_days)} días`,
              status: 'ACTIVE',
              config: { days: intValue(row.retention_days), action: clean(row.post_retention_action) },
            },
          ],
          actions: this.defaultPolicyActions(),
          approvals: [],
          metadata: { legalBasis: clean(row.legal_basis) },
          updatedAt: iso(row._updated_at) ?? NOW_SEED,
        })),
      );
    }
    if (!kind || kind === 'classification') {
      const rows = await this.queryRows(
        `SELECT _id, classification_code, classification_name, sensitivity_level, default_storage_mode, encryption_required, hashing_required, raw_storage_allowed, description, _updated_at FROM data_classification_policies WHERE _id::text = :id OR classification_code = :id LIMIT 1`,
        { id: rawId },
      );
      candidates.push(
        ...rows.map((row) => ({
          policyId: policyId('classification', row._id),
          key: clean(row.classification_code),
          name: clean(row.classification_name),
          policyType: 'CLASSIFICATION',
          status: 'ACTIVE',
          version: 'v1',
          owner: 'security',
          description: clean(row.description),
          effectiveFrom: NOW_SEED,
          effectiveUntil: null,
          affectedTables: [],
          affectedColumns: [],
          controls: [
            {
              controlId: `classification:${id(row._id)}`,
              controlType: 'STORAGE_MODE',
              label: clean(row.default_storage_mode),
              status: clean(row.sensitivity_level),
              config: {
                encryptionRequired: boolValue(row.encryption_required),
                hashingRequired: boolValue(row.hashing_required),
                rawStorageAllowed: boolValue(row.raw_storage_allowed),
              },
            },
          ],
          actions: this.defaultPolicyActions(),
          approvals: [],
          metadata: { sensitivityLevel: clean(row.sensitivity_level) },
          updatedAt: iso(row._updated_at) ?? NOW_SEED,
        })),
      );
    }
    if (!kind || kind === 'sensitive') {
      const rows = await this.queryRows(
        `SELECT _id, table_name, field_name, classification_code, storage_mode, masking_strategy, access_policy_code, is_active, _updated_at FROM sensitive_field_rules WHERE _id::text = :id LIMIT 1`,
        { id: rawId },
      );
      candidates.push(
        ...rows.map((row) => ({
          policyId: policyId('sensitive', row._id),
          key: `${clean(row.table_name)}.${clean(row.field_name)}`,
          name: `Campo sensible ${clean(row.table_name)}.${clean(row.field_name)}`,
          policyType: 'SENSITIVE_FIELD',
          status: boolValue(row.is_active, true) ? 'ACTIVE' : 'INACTIVE',
          version: 'v1',
          owner: 'security',
          description: `Clasificación ${clean(row.classification_code)} con almacenamiento ${clean(row.storage_mode)} y masking ${clean(row.masking_strategy)}.`,
          effectiveFrom: NOW_SEED,
          effectiveUntil: null,
          affectedTables: [clean(row.table_name)],
          affectedColumns: [clean(row.field_name)],
          controls: [
            {
              controlId: `sensitive:${id(row._id)}`,
              controlType: 'MASKING',
              label: clean(row.masking_strategy),
              status: 'ACTIVE',
              config: { storageMode: clean(row.storage_mode), accessPolicy: clean(row.access_policy_code) },
            },
          ],
          actions: this.defaultPolicyActions(),
          approvals: [],
          metadata: { classificationCode: clean(row.classification_code) },
          updatedAt: iso(row._updated_at) ?? NOW_SEED,
        })),
      );
    }
    if (!kind || kind === 'quality') {
      const rule = await this.queryRows(
        `SELECT _id, rule_code, rule_name, target_table, target_field, severity, expected_action, is_active, _updated_at FROM data_quality_rules WHERE _id::text = :id OR rule_code = :id LIMIT 1`,
        { id: rawId },
      );
      candidates.push(
        ...rule.map((row) => ({
          policyId: policyId('quality', row._id),
          key: clean(row.rule_code),
          name: clean(row.rule_name),
          policyType: 'DATA_QUALITY',
          status: boolValue(row.is_active, true) ? 'ACTIVE' : 'INACTIVE',
          version: 'v1',
          owner: 'data-quality',
          description: clean(row.expected_action),
          effectiveFrom: NOW_SEED,
          effectiveUntil: null,
          affectedTables: [clean(row.target_table)],
          affectedColumns: nullableText(row.target_field) ? [clean(row.target_field)] : [],
          controls: [
            {
              controlId: `quality:${id(row._id)}`,
              controlType: 'QUALITY_RULE',
              label: clean(row.severity),
              status: 'ACTIVE',
              config: { expectedAction: clean(row.expected_action) },
            },
          ],
          actions: this.defaultPolicyActions(),
          approvals: [],
          metadata: { severity: clean(row.severity) },
          updatedAt: iso(row._updated_at) ?? NOW_SEED,
        })),
      );
    }
    return candidates;
  }

  private defaultPolicyActions() {
    return [
      {
        actionKey: 'read',
        name: 'Lectura controlada',
        description: 'Permite consultar datos con auditoría.',
        operation: 'READ',
        enabled: true,
        requiresApproval: false,
        requiresReason: false,
        requiresAudit: true,
        config: {},
      },
      {
        actionKey: 'update',
        name: 'Actualización gobernada',
        description: 'Permite cambios solo si el flujo lo autoriza.',
        operation: 'UPDATE',
        enabled: true,
        requiresApproval: true,
        requiresReason: true,
        requiresAudit: true,
        config: {},
      },
      {
        actionKey: 'delete',
        name: 'Eliminación restringida',
        description: 'Bloquea hard delete salvo política expresa.',
        operation: 'DELETE',
        enabled: false,
        requiresApproval: true,
        requiresReason: true,
        requiresAudit: true,
        config: { hardDeleteAllowed: false },
      },
    ];
  }
}
