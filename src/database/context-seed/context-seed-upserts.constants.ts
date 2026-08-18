/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system declara los upserts idempotentes del paquete de contexto.
 */

/**
 * Cada upsert cuenta las filas que CAMBIÓ, no las que envió.
 *
 * Sembrar el mismo paquete dos veces tiene que informar cero cambios la segunda vez: es lo que
 * permite distinguir «ya estaba» de «no se aplicó». Por eso todos terminan en un `RETURNING 1`
 * contado, en vez de devolver el tamaño del lote.
 */

export const UPSERT_SOURCES_SQL = `
WITH changed AS (
  INSERT INTO catalog.context_sources
    (source_code, source_name, source_type, reliability_score, refresh_frequency, notes, is_active, _created_at, _updated_at)
  SELECT source_code, source_name, source_type, reliability_score::numeric, refresh_frequency, notes, is_active, NOW(), NOW()
  FROM jsonb_to_recordset(CAST($rows AS jsonb)) AS x(
    source_code text, source_name text, source_type text, reliability_score text,
    refresh_frequency text, notes text, is_active boolean
  )
  ON CONFLICT (source_code) DO UPDATE SET
    source_name = EXCLUDED.source_name,
    source_type = EXCLUDED.source_type,
    reliability_score = EXCLUDED.reliability_score,
    refresh_frequency = EXCLUDED.refresh_frequency,
    notes = EXCLUDED.notes,
    is_active = EXCLUDED.is_active,
    _updated_at = NOW()
  RETURNING 1
)
SELECT count(*)::int AS affected FROM changed;`;

export const UPSERT_CATALOGS_SQL = `
WITH changed AS (
  INSERT INTO catalog.context_catalogs
    (catalog_code, catalog_name, domain, description, owner_team, is_active, _created_at, _updated_at)
  SELECT catalog_code, catalog_name, domain, description, owner_team, is_active, NOW(), NOW()
  FROM jsonb_to_recordset(CAST($rows AS jsonb)) AS x(
    catalog_code text, catalog_name text, domain text, description text, owner_team text, is_active boolean
  )
  ON CONFLICT (catalog_code) DO UPDATE SET
    catalog_name = EXCLUDED.catalog_name,
    domain = EXCLUDED.domain,
    description = EXCLUDED.description,
    owner_team = EXCLUDED.owner_team,
    is_active = EXCLUDED.is_active,
    _updated_at = NOW()
  RETURNING 1
)
SELECT count(*)::int AS affected FROM changed;`;

export const UPSERT_VERSIONS_SQL = `
WITH changed AS (
  INSERT INTO catalog.context_catalog_versions
    (catalog_id, version_code, status, valid_from, valid_until, created_by_type, approved_by_type, approved_at, notes, _created_at)
  SELECT c._id, x.version_code, x.status, x.valid_from::date, x.valid_until::date,
         x.created_by_type, x.approved_by_type, x.approved_at::timestamptz, x.notes, NOW()
  FROM jsonb_to_recordset(CAST($rows AS jsonb)) AS x(
    catalog_code text, version_code text, status text, valid_from text, valid_until text,
    created_by_type text, approved_by_type text, approved_at text, notes text
  )
  JOIN catalog.context_catalogs c ON c.catalog_code = x.catalog_code
  ON CONFLICT (catalog_id, version_code)
    WHERE catalog_id IS NOT NULL AND version_code IS NOT NULL
  DO UPDATE SET
    status = EXCLUDED.status,
    valid_from = EXCLUDED.valid_from,
    valid_until = EXCLUDED.valid_until,
    created_by_type = EXCLUDED.created_by_type,
    approved_by_type = EXCLUDED.approved_by_type,
    approved_at = EXCLUDED.approved_at,
    notes = EXCLUDED.notes
  RETURNING 1
)
SELECT count(*)::int AS affected FROM changed;`;

export const UPSERT_ITEMS_SQL = `
WITH changed AS (
  INSERT INTO catalog.context_items
    (catalog_version_id, item_code, item_name, item_type, attributes_json, source_id,
     confidence_score, is_active, _created_at, _updated_at)
  SELECT v._id, x.item_code, x.item_name, x.item_type, x.attributes, s._id,
         x.confidence_score::numeric, x.is_active, NOW(), NOW()
  FROM jsonb_to_recordset(CAST($rows AS jsonb)) AS x(
    catalog_code text, version_code text, item_code text, item_name text, item_type text,
    attributes jsonb, source_code text, confidence_score text, is_active boolean
  )
  JOIN catalog.context_catalogs c ON c.catalog_code = x.catalog_code
  JOIN catalog.context_catalog_versions v ON v.catalog_id = c._id AND v.version_code = x.version_code
  JOIN catalog.context_sources s ON s.source_code = x.source_code
  ON CONFLICT (catalog_version_id, item_code)
    WHERE catalog_version_id IS NOT NULL AND item_code IS NOT NULL
  DO UPDATE SET
    item_name = EXCLUDED.item_name,
    item_type = EXCLUDED.item_type,
    attributes_json = EXCLUDED.attributes_json,
    source_id = EXCLUDED.source_id,
    confidence_score = EXCLUDED.confidence_score,
    is_active = EXCLUDED.is_active,
    _updated_at = NOW()
  RETURNING 1
)
SELECT count(*)::int AS affected FROM changed;`;

export const UPSERT_ALIASES_SQL = `
WITH changed AS (
  INSERT INTO catalog.context_item_aliases
    (context_item_id, alias_value, alias_type, normalized_alias, confidence_score, _created_at)
  SELECT i._id, x.alias_value, x.alias_type, x.normalized_alias, x.confidence_score::numeric, NOW()
  FROM jsonb_to_recordset(CAST($rows AS jsonb)) AS x(
    catalog_code text, version_code text, item_code text, alias_value text,
    alias_type text, normalized_alias text, confidence_score text
  )
  JOIN catalog.context_catalogs c ON c.catalog_code = x.catalog_code
  JOIN catalog.context_catalog_versions v ON v.catalog_id = c._id AND v.version_code = x.version_code
  JOIN catalog.context_items i ON i.catalog_version_id = v._id AND i.item_code = x.item_code
  ON CONFLICT (context_item_id, normalized_alias, alias_type)
    WHERE context_item_id IS NOT NULL AND normalized_alias IS NOT NULL AND alias_type IS NOT NULL
  DO UPDATE SET
    alias_value = EXCLUDED.alias_value,
    confidence_score = EXCLUDED.confidence_score
  RETURNING 1
)
SELECT count(*)::int AS affected FROM changed;`;

export const UPSERT_RISK_MAPPINGS_SQL = `
WITH changed AS (
  INSERT INTO catalog.context_risk_mappings
    (context_item_id, risk_dimension, risk_band, score_points_suggested, reason_code,
     explanation, model_usage, valid_from, valid_until, allowed_for_direct_adverse_credit_action,
     requires_calibration, _created_at)
  SELECT i._id, x.risk_dimension, x.risk_band, x.score_points_suggested::numeric, x.reason_code,
         x.explanation, x.model_usage, x.valid_from::date, x.valid_until::date,
         x.allowed_for_direct_adverse_credit_action, x.requires_calibration, NOW()
  FROM jsonb_to_recordset(CAST($rows AS jsonb)) AS x(
    catalog_code text, version_code text, item_code text, risk_dimension text, risk_band text,
    score_points_suggested text, reason_code text, explanation text, model_usage text,
    valid_from text, valid_until text, allowed_for_direct_adverse_credit_action boolean,
    requires_calibration boolean
  )
  JOIN catalog.context_catalogs c ON c.catalog_code = x.catalog_code
  JOIN catalog.context_catalog_versions v ON v.catalog_id = c._id AND v.version_code = x.version_code
  JOIN catalog.context_items i ON i.catalog_version_id = v._id AND i.item_code = x.item_code
  ON CONFLICT (context_item_id, risk_dimension, risk_band, reason_code, valid_from)
    WHERE context_item_id IS NOT NULL AND risk_dimension IS NOT NULL AND risk_band IS NOT NULL AND reason_code IS NOT NULL
  DO UPDATE SET
    score_points_suggested = EXCLUDED.score_points_suggested,
    explanation = EXCLUDED.explanation,
    model_usage = EXCLUDED.model_usage,
    valid_until = EXCLUDED.valid_until,
    allowed_for_direct_adverse_credit_action = EXCLUDED.allowed_for_direct_adverse_credit_action,
    requires_calibration = EXCLUDED.requires_calibration
  RETURNING 1
)
SELECT count(*)::int AS affected FROM changed;`;
