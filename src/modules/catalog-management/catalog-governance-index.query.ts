/**
 * @file Consulta de lectura: resuelve en SQL un listado paginado y sus conteos.
 * @business Esta pieza gobierna los catálogos que convierten datos externos y reglas de riesgo en decisiones consistentes.
 * @system implementa ingesta, versionado, aprobación, activación y consulta transaccional de catálogos.
 */
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';
import { buildPaginationMeta } from '../../common/utils/pagination/pagination.util.js';
import type { GovernancePolicySearchDto } from './catalog-list.schemas.js';

/**
 * Las cinco clases de política que el portal enseña en «Políticas de gobierno», en una sola lista
 * paginable. El `policyId` (`purpose:12`, `quality:3`…) es el que entiende `GET /internal/governance/policies/:policyId`.
 *
 * Son las MISMAS filas que `GET /operations/data-governance/policies` (activas, salvo clasificaciones,
 * que no tienen interruptor), pero aquella devuelve seis listas enteras y la pantalla las pintaba
 * como un muro de tarjetas sin buscador ni páginas. Aquí `q` busca en código, nombre y alcance.
 */
const ENTRIES_SQL = `
  SELECT 'purpose' AS type, 1 AS type_order, p._id::text AS raw_id, p.purpose_code AS code, p.purpose_name AS name,
         p.legal_basis AS scope, true AS is_active, COALESCE(p.requires_explicit_consent, false) AS explicit_consent, false AS protected,
         jsonb_build_object('legalBasis', p.legal_basis, 'requiresExplicitConsent', COALESCE(p.requires_explicit_consent, false)) AS attributes
    FROM privacy_processing_purposes p WHERE p.is_active = true
  UNION ALL
  SELECT 'retention', 2, r._id::text, r.policy_code, r.applies_to, r.applies_to, true, false, false,
         jsonb_build_object('retentionDays', r.retention_days, 'postRetentionAction', r.post_retention_action, 'legalBasis', r.legal_basis)
    FROM retention_policies r WHERE r.is_active = true
  UNION ALL
  SELECT 'classification', 3, c._id::text, c.classification_code, c.classification_name, c.sensitivity_level, true, false,
         (COALESCE(c.encryption_required, false) OR COALESCE(c.hashing_required, false)),
         jsonb_build_object('sensitivityLevel', c.sensitivity_level, 'defaultStorageMode', c.default_storage_mode,
           'encryptionRequired', COALESCE(c.encryption_required, false), 'hashingRequired', COALESCE(c.hashing_required, false),
           'rawStorageAllowed', COALESCE(c.raw_storage_allowed, false))
    FROM data_classification_policies c
  UNION ALL
  SELECT 'sensitive', 4, s._id::text, s.table_name || '.' || s.field_name, s.classification_code, s.table_name, true, false, false,
         jsonb_build_object('storageMode', s.storage_mode, 'maskingStrategy', s.masking_strategy, 'accessPolicyCode', s.access_policy_code)
    FROM sensitive_field_rules s WHERE s.is_active = true
  UNION ALL
  SELECT 'quality', 5, d._id::text, d.rule_code, d.rule_name, d.target_table || COALESCE('.' || d.target_field, ''), true, false, false,
         jsonb_build_object('severity', UPPER(COALESCE(d.severity, 'medium')), 'expectedAction', d.expected_action)
    FROM data_quality_rules d WHERE d.is_active = true`;

const FILTER_SQL = `(:type = '' OR e.type = :type) AND (:q = '' OR e.code ILIKE :like OR e.name ILIKE :like OR COALESCE(e.scope, '') ILIKE :like)`;

type EntryRow = {
  type: string;
  raw_id: string;
  code: string | null;
  name: string | null;
  scope: string | null;
  is_active: boolean;
  attributes: Record<string, unknown>;
};
type SummaryRow = { type: string; count: string; explicit_consent: string; protected: string };

export async function searchGovernancePolicies(sequelize: Sequelize, query: GovernancePolicySearchDto) {
  const q = query.q ?? '';
  const replacements = { q, like: containsLikePattern(q), type: query.type ?? '' };
  const [rows, summaryRows] = await Promise.all([
    sequelize.query<EntryRow>(
      `SELECT e.type, e.raw_id, e.code, e.name, e.scope, e.is_active, e.attributes FROM (${ENTRIES_SQL}) e
        WHERE ${FILTER_SQL} ORDER BY e.type_order, e.code, e.raw_id LIMIT :limit OFFSET :offset`,
      { replacements: { ...replacements, limit: query.limit, offset: (query.page - 1) * query.limit }, type: QueryTypes.SELECT },
    ),
    // Con el MISMO filtro que la página: las tarjetas contaban las filas del muro ya cargado.
    sequelize.query<SummaryRow>(
      `SELECT e.type, COUNT(*)::text AS count, COUNT(*) FILTER (WHERE e.explicit_consent)::text AS explicit_consent,
              COUNT(*) FILTER (WHERE e.protected)::text AS protected
         FROM (${ENTRIES_SQL}) e WHERE ${FILTER_SQL} GROUP BY e.type`,
      { replacements, type: QueryTypes.SELECT },
    ),
  ]);
  const byType: Record<string, number> = {};
  let explicitConsent = 0;
  let protectedClasses = 0;
  for (const row of summaryRows) {
    byType[row.type] = Number(row.count);
    explicitConsent += Number(row.explicit_consent);
    protectedClasses += Number(row.protected);
  }
  const total = Object.values(byType).reduce((sum, value) => sum + value, 0);
  return {
    items: rows.map((row) => ({
      policyId: `${row.type}:${row.raw_id}`,
      type: row.type,
      code: row.code,
      name: row.name,
      scope: row.scope,
      isActive: row.is_active,
      attributes: row.attributes,
    })),
    meta: buildPaginationMeta({ page: query.page, limit: query.limit }, total),
    summary: { total, byType, sensitiveFields: byType.sensitive ?? 0, explicitConsent, protectedClasses },
  };
}
