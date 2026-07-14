import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

const BATCH_SIZE = 1_000;
const EXPECTED_SCHEMA_VERSION = '2.0.0';
const FORBIDDEN_ID_KEYS = new Set(['_id', 'catalog_version_id', 'source_id', 'context_item_id']);

type JsonRecord = Record<string, unknown>;

type ManifestChunk = {
  catalogCode: string;
  relativePath: string;
  itemCount: number;
  bytes: number;
};

type PackageManifest = {
  schemaVersion: string;
  loadingStrategy: string;
  totalItems: number;
  chunkCount: number;
  chunks: ManifestChunk[];
};

type BootstrapSeed = {
  schemaVersion: string;
  environmentScope: string;
  loadingStrategy: string;
  contextSources: JsonRecord[];
  contextCatalogs: JsonRecord[];
  contextCatalogVersions: JsonRecord[];
};

type SupportingSeed = {
  schemaVersion: string;
  versionCode: string;
  dimensionItems: JsonRecord[];
  profileItems: JsonRecord[];
};

type ItemsSeed = {
  schemaVersion: string;
  catalogCode: string;
  versionCode: string;
  loadingStrategy: string;
  count: number;
  items: JsonRecord[];
};

type ReferenceSeed = {
  count: number;
  items: JsonRecord[];
};

type PackageEntrypoint = {
  package: {
    buildVersion: string;
    environmentScope: string;
    status: string;
    primaryDataCount: number;
  };
};

export type ContextSeedLoadReport = {
  packageBuildVersion: string;
  chunksLoaded: number;
  chunksSkipped: number;
  materializedItems: number;
  supportingItems: number;
  aliases: number;
  riskMappings: number;
  dryRun: boolean;
};

export type ContextSeedLoadOptions = {
  packageDirectory: string;
  sequelize?: Sequelize;
  dryRun?: boolean;
  force?: boolean;
  allowProduction?: boolean;
  log?: (message: string) => void;
};

function assertRecord(value: unknown, label: string): asserts value is JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} debe ser un objeto JSON.`);
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} debe ser un arreglo JSON.`);
}

function requireString(record: JsonRecord, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label}.${key} debe ser un string no vacio.`);
  return value;
}

function rejectImportedNumericIds(value: unknown, label: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectImportedNumericIds(entry, `${label}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    if (FORBIDDEN_ID_KEYS.has(key)) throw new Error(`${label} contiene el identificador importado prohibido ${key}.`);
    rejectImportedNumericIds(child, `${label}.${key}`);
  }
}

async function readJson<T>(path: string, label: string): Promise<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`No se pudo leer ${label} (${path}).`, { cause: error });
  }
  assertRecord(parsed, label);
  return parsed as T;
}

function resolvePackageFile(packageDirectory: string, relativePath: string): string {
  if (isAbsolute(relativePath)) throw new Error(`El manifest contiene una ruta absoluta no permitida: ${relativePath}`);
  const root = resolve(packageDirectory);
  const path = resolve(root, normalize(relativePath));
  const pathFromRoot = relative(root, path);
  if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) throw new Error(`La ruta sale del paquete: ${relativePath}`);
  return path;
}

function validateHeader(record: JsonRecord, label: string): void {
  if (record.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    throw new Error(`${label}.schemaVersion debe ser ${EXPECTED_SCHEMA_VERSION}.`);
  }
}

function validateItem(
  item: unknown,
  expectedCatalogCode: string | undefined,
  expectedVersionCode: string | undefined,
  label: string,
): JsonRecord {
  assertRecord(item, label);
  rejectImportedNumericIds(item, label);
  const catalogCode = requireString(item, 'catalogCode', label);
  const versionCode = requireString(item, 'versionCode', label);
  requireString(item, 'itemCode', label);
  requireString(item, 'itemName', label);
  requireString(item, 'itemType', label);
  requireString(item, 'sourceCode', label);
  if (expectedCatalogCode && catalogCode !== expectedCatalogCode) throw new Error(`${label}.catalogCode no coincide con el chunk.`);
  if (expectedVersionCode && versionCode !== expectedVersionCode) throw new Error(`${label}.versionCode no coincide con el chunk.`);
  return item;
}

function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function affectedRows(sequelize: Sequelize, sql: string, rows: JsonRecord[], transaction: Transaction): Promise<number> {
  const result = await sequelize.query<{ affected: number }>(sql, {
    bind: { rows: JSON.stringify(rows) },
    transaction,
    type: QueryTypes.SELECT,
  });
  return Number(result[0]?.affected ?? 0);
}

const UPSERT_SOURCES_SQL = `
WITH changed AS (
  INSERT INTO public.context_sources
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

const UPSERT_CATALOGS_SQL = `
WITH changed AS (
  INSERT INTO public.context_catalogs
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

const UPSERT_VERSIONS_SQL = `
WITH changed AS (
  INSERT INTO public.context_catalog_versions
    (catalog_id, version_code, status, valid_from, valid_until, created_by_type, approved_by_type, approved_at, notes, _created_at)
  SELECT c._id, x.version_code, x.status, x.valid_from::date, x.valid_until::date,
         x.created_by_type, x.approved_by_type, x.approved_at::timestamptz, x.notes, NOW()
  FROM jsonb_to_recordset(CAST($rows AS jsonb)) AS x(
    catalog_code text, version_code text, status text, valid_from text, valid_until text,
    created_by_type text, approved_by_type text, approved_at text, notes text
  )
  JOIN public.context_catalogs c ON c.catalog_code = x.catalog_code
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

const UPSERT_ITEMS_SQL = `
WITH changed AS (
  INSERT INTO public.context_items
    (catalog_version_id, item_code, item_name, item_type, attributes_json, source_id,
     confidence_score, is_active, _created_at, _updated_at)
  SELECT v._id, x.item_code, x.item_name, x.item_type, x.attributes, s._id,
         x.confidence_score::numeric, x.is_active, NOW(), NOW()
  FROM jsonb_to_recordset(CAST($rows AS jsonb)) AS x(
    catalog_code text, version_code text, item_code text, item_name text, item_type text,
    attributes jsonb, source_code text, confidence_score text, is_active boolean
  )
  JOIN public.context_catalogs c ON c.catalog_code = x.catalog_code
  JOIN public.context_catalog_versions v ON v.catalog_id = c._id AND v.version_code = x.version_code
  JOIN public.context_sources s ON s.source_code = x.source_code
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

const UPSERT_ALIASES_SQL = `
WITH changed AS (
  INSERT INTO public.context_item_aliases
    (context_item_id, alias_value, alias_type, normalized_alias, confidence_score, _created_at)
  SELECT i._id, x.alias_value, x.alias_type, x.normalized_alias, x.confidence_score::numeric, NOW()
  FROM jsonb_to_recordset(CAST($rows AS jsonb)) AS x(
    catalog_code text, version_code text, item_code text, alias_value text,
    alias_type text, normalized_alias text, confidence_score text
  )
  JOIN public.context_catalogs c ON c.catalog_code = x.catalog_code
  JOIN public.context_catalog_versions v ON v.catalog_id = c._id AND v.version_code = x.version_code
  JOIN public.context_items i ON i.catalog_version_id = v._id AND i.item_code = x.item_code
  ON CONFLICT (context_item_id, normalized_alias, alias_type)
    WHERE context_item_id IS NOT NULL AND normalized_alias IS NOT NULL AND alias_type IS NOT NULL
  DO UPDATE SET
    alias_value = EXCLUDED.alias_value,
    confidence_score = EXCLUDED.confidence_score
  RETURNING 1
)
SELECT count(*)::int AS affected FROM changed;`;

const UPSERT_RISK_MAPPINGS_SQL = `
WITH changed AS (
  INSERT INTO public.context_risk_mappings
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
  JOIN public.context_catalogs c ON c.catalog_code = x.catalog_code
  JOIN public.context_catalog_versions v ON v.catalog_id = c._id AND v.version_code = x.version_code
  JOIN public.context_items i ON i.catalog_version_id = v._id AND i.item_code = x.item_code
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

function sourceRows(items: JsonRecord[]): JsonRecord[] {
  return items.map((item, index) => ({
    source_code: requireString(item, 'sourceCode', `contextSources[${index}]`),
    source_name: item.sourceName,
    source_type: item.sourceType,
    reliability_score: item.reliabilityScore,
    refresh_frequency: item.refreshFrequency,
    notes: item.notes,
    is_active: item.isActive,
  }));
}

function catalogRows(items: JsonRecord[]): JsonRecord[] {
  return items.map((item, index) => ({
    catalog_code: requireString(item, 'catalogCode', `contextCatalogs[${index}]`),
    catalog_name: item.catalogName,
    domain: item.domain,
    description: item.description,
    owner_team: item.ownerTeam,
    is_active: item.isActive,
  }));
}

function versionRows(items: JsonRecord[]): JsonRecord[] {
  return items.map((item, index) => ({
    catalog_code: requireString(item, 'catalogCode', `contextCatalogVersions[${index}]`),
    version_code: requireString(item, 'versionCode', `contextCatalogVersions[${index}]`),
    status: item.status,
    valid_from: item.validFrom,
    valid_until: item.validUntil,
    created_by_type: item.createdByType,
    approved_by_type: item.approvedByType,
    approved_at: item.approvedAt,
    notes: item.notes,
  }));
}

function itemRows(items: JsonRecord[], label: string): JsonRecord[] {
  return items.map((rawItem, index) => {
    const item = validateItem(rawItem, undefined, undefined, `${label}[${index}]`);
    return {
      catalog_code: item.catalogCode,
      version_code: item.versionCode,
      item_code: item.itemCode,
      item_name: item.itemName,
      item_type: item.itemType,
      attributes: item.attributes ?? {},
      source_code: item.sourceCode,
      confidence_score: item.confidenceScore,
      is_active: item.isActive,
    };
  });
}

function aliasRows(items: JsonRecord[]): JsonRecord[] {
  return items.map((item, index) => {
    rejectImportedNumericIds(item, `aliases[${index}]`);
    assertRecord(item.contextItemRef, `aliases[${index}].contextItemRef`);
    const ref = item.contextItemRef;
    return {
      catalog_code: requireString(ref, 'catalogCode', `aliases[${index}].contextItemRef`),
      version_code: requireString(ref, 'versionCode', `aliases[${index}].contextItemRef`),
      item_code: requireString(ref, 'itemCode', `aliases[${index}].contextItemRef`),
      alias_value: item.aliasValue,
      alias_type: item.aliasType,
      normalized_alias: item.normalizedAlias,
      confidence_score: item.confidenceScore,
    };
  });
}

function riskRows(items: JsonRecord[]): JsonRecord[] {
  return items.map((item, index) => {
    rejectImportedNumericIds(item, `riskMappings[${index}]`);
    assertRecord(item.contextItemRef, `riskMappings[${index}].contextItemRef`);
    const ref = item.contextItemRef;
    return {
      catalog_code: requireString(ref, 'catalogCode', `riskMappings[${index}].contextItemRef`),
      version_code: requireString(ref, 'versionCode', `riskMappings[${index}].contextItemRef`),
      item_code: requireString(ref, 'itemCode', `riskMappings[${index}].contextItemRef`),
      risk_dimension: item.riskDimension,
      risk_band: item.riskBand,
      score_points_suggested: item.scorePointsSuggested,
      reason_code: item.reasonCode,
      explanation: item.explanation,
      model_usage: item.modelUsage,
      valid_from: item.validFrom,
      valid_until: item.validUntil,
      allowed_for_direct_adverse_credit_action: item.allowedForDirectAdverseCreditAction,
      requires_calibration: item.requiresCalibration,
    };
  });
}

async function upsertBatches(
  sequelize: Sequelize,
  sql: string,
  rows: JsonRecord[],
  transaction: Transaction,
  label: string,
): Promise<void> {
  let offset = 0;
  for (const batch of chunksOf(rows, BATCH_SIZE)) {
    const affected = await affectedRows(sequelize, sql, batch, transaction);
    if (affected !== batch.length) {
      throw new Error(
        `${label}: se resolvieron ${affected}/${batch.length} filas en el offset ${offset}; revise las claves foraneas naturales.`,
      );
    }
    offset += batch.length;
  }
}

async function loadBootstrap(sequelize: Sequelize, bootstrap: BootstrapSeed): Promise<void> {
  await sequelize.transaction(async (transaction) => {
    await upsertBatches(sequelize, UPSERT_SOURCES_SQL, sourceRows(bootstrap.contextSources), transaction, 'context_sources');
    await upsertBatches(sequelize, UPSERT_CATALOGS_SQL, catalogRows(bootstrap.contextCatalogs), transaction, 'context_catalogs');
    await upsertBatches(
      sequelize,
      UPSERT_VERSIONS_SQL,
      versionRows(bootstrap.contextCatalogVersions),
      transaction,
      'context_catalog_versions',
    );
  });
}

async function checkpointMatches(sequelize: Sequelize, chunk: ManifestChunk, sha256: string, transaction: Transaction): Promise<boolean> {
  const rows = await sequelize.query<{ content_sha256: string }>(
    `SELECT content_sha256
       FROM public.context_seed_import_checkpoints
      WHERE catalog_code = $catalogCode AND relative_path = $relativePath AND item_count = $itemCount`,
    {
      bind: { catalogCode: chunk.catalogCode, relativePath: chunk.relativePath, itemCount: chunk.itemCount },
      transaction,
      type: QueryTypes.SELECT,
    },
  );
  return rows[0]?.content_sha256 === sha256;
}

async function saveCheckpoint(
  sequelize: Sequelize,
  packageBuildVersion: string,
  chunk: ManifestChunk,
  sha256: string,
  transaction: Transaction,
): Promise<void> {
  await sequelize.query(
    `INSERT INTO public.context_seed_import_checkpoints
       (package_build_version, catalog_code, relative_path, item_count, content_sha256, completed_at)
     VALUES ($packageBuildVersion, $catalogCode, $relativePath, $itemCount, $sha256, NOW())
     ON CONFLICT (catalog_code, relative_path, item_count) DO UPDATE SET
       package_build_version = EXCLUDED.package_build_version,
       content_sha256 = EXCLUDED.content_sha256,
       completed_at = EXCLUDED.completed_at`,
    {
      bind: {
        packageBuildVersion,
        catalogCode: chunk.catalogCode,
        relativePath: chunk.relativePath,
        itemCount: chunk.itemCount,
        sha256,
      },
      transaction,
    },
  );
}

async function reconcile(
  sequelize: Sequelize,
  manifest: PackageManifest,
  supporting: SupportingSeed,
  aliases: ReferenceSeed,
  riskMappings: ReferenceSeed,
): Promise<void> {
  const expectedByCatalog = new Map<string, number>();
  for (const chunk of manifest.chunks)
    expectedByCatalog.set(chunk.catalogCode, (expectedByCatalog.get(chunk.catalogCode) ?? 0) + chunk.itemCount);
  const counts = await sequelize.query<{ catalog_code: string; count: string }>(
    `SELECT c.catalog_code, count(*)::text AS count
       FROM public.context_items i
       JOIN public.context_catalog_versions v ON v._id = i.catalog_version_id
       JOIN public.context_catalogs c ON c._id = v.catalog_id
      WHERE i.item_type = 'context_binding'
        AND c.catalog_code IN (SELECT jsonb_array_elements_text(CAST($catalogCodes AS jsonb)))
      GROUP BY c.catalog_code`,
    { bind: { catalogCodes: JSON.stringify([...expectedByCatalog.keys()]) }, type: QueryTypes.SELECT },
  );
  const actualByCatalog = new Map(counts.map((row) => [row.catalog_code, Number(row.count)]));
  for (const [catalogCode, expected] of expectedByCatalog) {
    const actual = actualByCatalog.get(catalogCode) ?? 0;
    if (actual !== expected) throw new Error(`Reconciliacion fallida para ${catalogCode}: esperado ${expected}, actual ${actual}.`);
  }

  const expectedReferenceByType = new Map<string, number>();
  for (const [index, item] of [...supporting.dimensionItems, ...supporting.profileItems].entries()) {
    const itemType = requireString(item, 'itemType', `supportingItems[${index}]`);
    expectedReferenceByType.set(itemType, (expectedReferenceByType.get(itemType) ?? 0) + 1);
  }
  const referenceCounts = await sequelize.query<{ item_type: string; count: string }>(
    `SELECT i.item_type, count(*)::text AS count
       FROM public.context_items i
       JOIN public.context_catalog_versions v ON v._id = i.catalog_version_id
      WHERE v.version_code = $versionCode
        AND i.item_type IN (SELECT jsonb_array_elements_text(CAST($itemTypes AS jsonb)))
      GROUP BY i.item_type`,
    {
      bind: { versionCode: supporting.versionCode, itemTypes: JSON.stringify([...expectedReferenceByType.keys()]) },
      type: QueryTypes.SELECT,
    },
  );
  const countByType = new Map(referenceCounts.map((row) => [row.item_type, Number(row.count)]));
  for (const [itemType, expected] of expectedReferenceByType) {
    const actual = countByType.get(itemType) ?? 0;
    if (actual !== expected) throw new Error(`Reconciliacion fallida para ${itemType}: esperado ${expected}, actual ${actual}.`);
  }

  const related = await sequelize.query<{ aliases: string; risk_mappings: string }>(
    `SELECT
       count(DISTINCT a._id)::text AS aliases,
       count(DISTINCT r._id)::text AS risk_mappings
     FROM public.context_catalog_versions v
     JOIN public.context_items i ON i.catalog_version_id = v._id
     LEFT JOIN public.context_item_aliases a ON a.context_item_id = i._id
     LEFT JOIN public.context_risk_mappings r ON r.context_item_id = i._id
     WHERE v.version_code = $versionCode`,
    { bind: { versionCode: supporting.versionCode }, type: QueryTypes.SELECT },
  );
  if (Number(related[0]?.aliases ?? 0) !== aliases.count) throw new Error('Reconciliacion fallida para context_item_aliases.');
  if (Number(related[0]?.risk_mappings ?? 0) !== riskMappings.count) throw new Error('Reconciliacion fallida para context_risk_mappings.');
}

export async function loadMultidomainContextPackage(options: ContextSeedLoadOptions): Promise<ContextSeedLoadReport> {
  const log = options.log ?? ((message: string) => process.stdout.write(`${message}\n`));
  const packageDirectory = resolve(options.packageDirectory);
  const entrypoint = await readJson<PackageEntrypoint>(join(packageDirectory, 'ATLAS_CONTEXT_SEED_ENTRYPOINT.json'), 'entrypoint');
  const manifest = await readJson<PackageManifest>(join(packageDirectory, '00_manifest', 'database_seed_manifest.json'), 'manifest');
  const bootstrap = await readJson<BootstrapSeed>(join(packageDirectory, '01_bootstrap_seed', 'bootstrap_seed.json'), 'bootstrap');
  const supporting = await readJson<SupportingSeed>(
    join(packageDirectory, '02_normalized_reference', 'supporting_context_items_seed.json'),
    'supporting seed',
  );
  const aliases = await readJson<ReferenceSeed>(
    join(packageDirectory, '02_normalized_reference', 'context_item_aliases_seed.json'),
    'alias seed',
  );
  const riskMappings = await readJson<ReferenceSeed>(
    join(packageDirectory, '02_normalized_reference', 'context_risk_mappings_seed.json'),
    'risk mapping seed',
  );

  assertRecord(entrypoint.package, 'entrypoint.package');
  validateHeader(manifest as unknown as JsonRecord, 'manifest');
  validateHeader(bootstrap as unknown as JsonRecord, 'bootstrap');
  validateHeader(supporting as unknown as JsonRecord, 'supporting seed');
  assertArray(manifest.chunks, 'manifest.chunks');
  assertArray(bootstrap.contextSources, 'bootstrap.contextSources');
  assertArray(bootstrap.contextCatalogs, 'bootstrap.contextCatalogs');
  assertArray(bootstrap.contextCatalogVersions, 'bootstrap.contextCatalogVersions');
  assertArray(supporting.dimensionItems, 'supporting.dimensionItems');
  assertArray(supporting.profileItems, 'supporting.profileItems');
  assertArray(aliases.items, 'aliases.items');
  assertArray(riskMappings.items, 'riskMappings.items');

  if (entrypoint.package.status !== 'PASS') throw new Error(`El paquete no esta aprobado: status=${entrypoint.package.status}.`);
  if (entrypoint.package.environmentScope !== 'preproduction' || bootstrap.environmentScope !== 'preproduction') {
    throw new Error('Solo se acepta el paquete con scope preproduction.');
  }
  if (manifest.loadingStrategy !== 'natural_key_upsert' || bootstrap.loadingStrategy !== 'natural_key_upsert') {
    throw new Error('El paquete debe usar loadingStrategy=natural_key_upsert.');
  }
  if (manifest.chunkCount !== manifest.chunks.length) throw new Error('manifest.chunkCount no coincide con manifest.chunks.length.');
  if (manifest.totalItems !== manifest.chunks.reduce((sum, chunk) => sum + chunk.itemCount, 0)) {
    throw new Error('manifest.totalItems no coincide con la suma de chunks.');
  }
  if (manifest.totalItems !== entrypoint.package.primaryDataCount) throw new Error('El total del manifest no coincide con el entrypoint.');
  if (aliases.count !== aliases.items.length || riskMappings.count !== riskMappings.items.length)
    throw new Error('Un seed de referencias tiene count invalido.');

  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && !options.allowProduction) {
    throw new Error('El paquete es preproduction-only. En produccion se requiere --allow-production y aprobacion externa explicita.');
  }

  const report: ContextSeedLoadReport = {
    packageBuildVersion: entrypoint.package.buildVersion,
    chunksLoaded: 0,
    chunksSkipped: 0,
    materializedItems: 0,
    supportingItems: supporting.dimensionItems.length + supporting.profileItems.length,
    aliases: aliases.count,
    riskMappings: riskMappings.count,
    dryRun: options.dryRun ?? false,
  };

  const sequelize = options.sequelize;
  if (!options.dryRun && !sequelize) throw new Error('Se requiere una instancia Sequelize cuando dryRun=false.');

  if (sequelize) {
    await loadBootstrap(sequelize, bootstrap);
    await sequelize.transaction(async (transaction) => {
      await upsertBatches(
        sequelize,
        UPSERT_ITEMS_SQL,
        itemRows(supporting.dimensionItems, 'dimensionItems'),
        transaction,
        'dimensionItems',
      );
      await upsertBatches(sequelize, UPSERT_ITEMS_SQL, itemRows(supporting.profileItems, 'profileItems'), transaction, 'profileItems');
    });
  } else {
    itemRows(supporting.dimensionItems, 'dimensionItems');
    itemRows(supporting.profileItems, 'profileItems');
  }

  for (const [index, chunk] of manifest.chunks.entries()) {
    const chunkPath = resolvePackageFile(packageDirectory, chunk.relativePath);
    const fileStats = await stat(chunkPath);
    if (fileStats.size !== chunk.bytes)
      throw new Error(`${chunk.relativePath}: bytes esperados ${chunk.bytes}, actuales ${fileStats.size}.`);
    const content = await readFile(chunkPath);
    const sha256 = createHash('sha256').update(content).digest('hex');

    if (!sequelize) {
      const parsed = JSON.parse(content.toString('utf8')) as unknown;
      assertRecord(parsed, chunk.relativePath);
      const seed = parsed as unknown as ItemsSeed;
      validateHeader(parsed, chunk.relativePath);
      assertArray(seed.items, `${chunk.relativePath}.items`);
      if (seed.catalogCode !== chunk.catalogCode || seed.count !== chunk.itemCount || seed.items.length !== chunk.itemCount) {
        throw new Error(`${chunk.relativePath}: metadata o conteo inconsistente.`);
      }
      seed.items.forEach((item, itemIndex) =>
        validateItem(item, seed.catalogCode, seed.versionCode, `${chunk.relativePath}.items[${itemIndex}]`),
      );
      report.chunksLoaded += 1;
      report.materializedItems += seed.items.length;
      log(`[validate ${index + 1}/${manifest.chunkCount}] ${chunk.relativePath}: ${seed.items.length} items`);
      continue;
    }

    await sequelize.transaction(async (transaction) => {
      const lockKey = `${chunk.catalogCode}|${chunk.relativePath}|${chunk.itemCount}`;
      await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended($key, 0))', {
        bind: { key: lockKey },
        transaction,
      });
      if (!options.force && (await checkpointMatches(sequelize, chunk, sha256, transaction))) {
        report.chunksSkipped += 1;
        report.materializedItems += chunk.itemCount;
        return;
      }

      const parsed = JSON.parse(content.toString('utf8')) as unknown;
      assertRecord(parsed, chunk.relativePath);
      const seed = parsed as unknown as ItemsSeed;
      validateHeader(parsed, chunk.relativePath);
      assertArray(seed.items, `${chunk.relativePath}.items`);
      if (
        seed.loadingStrategy !== 'natural_key_upsert' ||
        seed.catalogCode !== chunk.catalogCode ||
        seed.count !== chunk.itemCount ||
        seed.items.length !== chunk.itemCount
      ) {
        throw new Error(`${chunk.relativePath}: metadata o conteo inconsistente.`);
      }
      seed.items.forEach((item, itemIndex) =>
        validateItem(item, seed.catalogCode, seed.versionCode, `${chunk.relativePath}.items[${itemIndex}]`),
      );
      await upsertBatches(
        sequelize,
        UPSERT_ITEMS_SQL,
        itemRows(seed.items, `${chunk.relativePath}.items`),
        transaction,
        chunk.relativePath,
      );
      await saveCheckpoint(sequelize, entrypoint.package.buildVersion, chunk, sha256, transaction);
      report.chunksLoaded += 1;
      report.materializedItems += seed.items.length;
    });
    log(`[load ${index + 1}/${manifest.chunkCount}] ${chunk.relativePath}`);
  }

  const aliasPayload = aliasRows(aliases.items);
  const riskPayload = riskRows(riskMappings.items);
  if (sequelize) {
    await sequelize.transaction(async (transaction) => {
      await upsertBatches(sequelize, UPSERT_ALIASES_SQL, aliasPayload, transaction, 'context_item_aliases');
      await upsertBatches(sequelize, UPSERT_RISK_MAPPINGS_SQL, riskPayload, transaction, 'context_risk_mappings');
    });
    await reconcile(sequelize, manifest, supporting, aliases, riskMappings);
  }

  return report;
}
