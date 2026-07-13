import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { buildSequelizeOptions } from '../src/config/database.config.js';

/**
 * Sequelize sin `models` (igual que `createSequelizeInstance`) pero con
 * `logging: false` explícito: el logger por defecto imprime el SQL completo de
 * cada statement, y con 24 chunks x 20 batches de 2,500 filas cada uno eso
 * satura la salida sin aportar nada (no hay valores de bind visibles, solo el
 * texto con placeholders $N repetido cientos de veces).
 */
function createInjectionSequelize(): Sequelize {
  return new Sequelize({ ...buildSequelizeOptions(), models: [], logging: false });
}

/**
 * Inyecta el paquete "ATLAS Multidomain Context Definitive 1.2M" (bootstrap +
 * catálogos de soporte/perfil + 24 chunks de bindings materializados + aliases
 * + risk mappings) siguiendo exactamente `recommendedInjectionPath` y
 * `upsertRules` de ATLAS_CONTEXT_SEED_ENTRYPOINT.json / backend_seed_loader_contract.json
 * del propio paquete: upsert por clave natural (nunca por _id numérico), una
 * transacción por chunk de 50,000 filas, y resolución de FKs por código natural
 * (catalogCode/versionCode/itemCode/sourceCode), no por ids importados.
 *
 * Requiere la migración `20260713000000-add-context-catalog-natural-key-indexes`
 * aplicada primero (agrega los índices únicos parciales que hacen posible el
 * `ON CONFLICT` por clave natural — las tablas solo traían índices no-únicos).
 */

const SEED_ROOT =
  process.argv[2] ??
  process.env.ATLAS_CONTEXT_SEED_ROOT ??
  'C:\\Users\\DELL\\Downloads\\atlas_contexto_multidominio_definitivo_1_2m\\atlas_contexto_multidominio_definitivo_1_2m';

const CHUNK_BATCH_SIZE = 2500;
const RUN_TIMESTAMP = new Date();

type JsonRecord = Record<string, unknown>;

function readJson<T>(relativePath: string): T {
  const fullPath = join(SEED_ROOT, relativePath);
  return JSON.parse(readFileSync(fullPath, 'utf8')) as T;
}

function str(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

function bool(value: unknown): boolean | null {
  return value === undefined || value === null ? null : Boolean(value);
}

function jsonb(value: unknown): string {
  return JSON.stringify(value ?? {});
}

/**
 * Construye e inserta un lote multi-row `INSERT ... ON CONFLICT (...) DO UPDATE`.
 * `conflictWhere` debe ser exactamente el predicado del índice único parcial
 * correspondiente (creado en la migración 20260713000000), o Postgres rechaza
 * el `ON CONFLICT` por no encontrar un índice de inferencia que calce.
 */
async function upsertBatch(
  sequelize: Sequelize,
  table: string,
  columns: string[],
  conflictColumns: string[],
  conflictWhere: string | null,
  updateColumns: string[],
  rows: unknown[][],
  transaction: Transaction,
  returning?: string[],
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return [];

  const colCount = columns.length;
  const valuesSql = rows
    .map((_, rowIndex) => `(${columns.map((__, colIndex) => `$${rowIndex * colCount + colIndex + 1}`).join(',')})`)
    .join(',');
  const bind = rows.flat();
  const whereSql = conflictWhere ? ` WHERE ${conflictWhere}` : '';
  const updateSql =
    updateColumns.length > 0
      ? `DO UPDATE SET ${updateColumns.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`
      : 'DO NOTHING';
  const returningSql = returning && returning.length > 0 ? ` RETURNING ${returning.join(',')}` : '';

  const sql = `
    INSERT INTO ${table} (${columns.join(',')})
    VALUES ${valuesSql}
    ON CONFLICT (${conflictColumns.join(',')})${whereSql}
    ${updateSql}
    ${returningSql}
  `;

  if (returningSql) {
    return (await sequelize.query(sql, { bind, transaction, type: QueryTypes.SELECT })) as Record<string, unknown>[];
  }
  await sequelize.query(sql, { bind, transaction, type: QueryTypes.RAW });
  return [];
}

async function main(): Promise<void> {
  console.log(`Seed root: ${SEED_ROOT}`);
  const sequelize = createInjectionSequelize();
  const startedAt = Date.now();

  try {
    // ---- 1) context_sources -------------------------------------------------
    const bootstrap = readJson<{
      contextSources: JsonRecord[];
      contextCatalogs: JsonRecord[];
      contextCatalogVersions: JsonRecord[];
    }>('01_bootstrap_seed/bootstrap_seed.json');

    const sourceMap = new Map<string, string>();
    await sequelize.transaction(async (t) => {
      const rows = bootstrap.contextSources.map((s) => [
        str(s.sourceCode),
        str(s.sourceName),
        str(s.sourceType),
        str(s.reliabilityScore),
        str(s.refreshFrequency),
        str(s.notes),
        bool(s.isActive),
        RUN_TIMESTAMP,
        RUN_TIMESTAMP,
      ]);
      const returned = await upsertBatch(
        sequelize,
        'context_sources',
        ['source_code', 'source_name', 'source_type', 'reliability_score', 'refresh_frequency', 'notes', 'is_active', '_created_at', '_updated_at'],
        ['source_code'],
        null,
        ['source_name', 'source_type', 'reliability_score', 'refresh_frequency', 'notes', 'is_active', '_updated_at'],
        rows,
        t,
        ['_id', 'source_code'],
      );
      for (const r of returned) sourceMap.set(String(r.source_code), String(r._id));
    });
    console.log(`[1/7] context_sources: ${sourceMap.size} filas`);

    // ---- 2) context_catalogs --------------------------------------------------
    const catalogMap = new Map<string, string>();
    await sequelize.transaction(async (t) => {
      const rows = bootstrap.contextCatalogs.map((c) => [
        str(c.catalogCode),
        str(c.catalogName),
        str(c.domain),
        str(c.description),
        str(c.ownerTeam),
        bool(c.isActive),
        RUN_TIMESTAMP,
        RUN_TIMESTAMP,
      ]);
      const returned = await upsertBatch(
        sequelize,
        'context_catalogs',
        ['catalog_code', 'catalog_name', 'domain', 'description', 'owner_team', 'is_active', '_created_at', '_updated_at'],
        ['catalog_code'],
        null,
        ['catalog_name', 'domain', 'description', 'owner_team', 'is_active', '_updated_at'],
        rows,
        t,
        ['_id', 'catalog_code'],
      );
      for (const r of returned) catalogMap.set(String(r.catalog_code), String(r._id));
    });
    console.log(`[2/7] context_catalogs: ${catalogMap.size} filas`);

    // ---- 3) context_catalog_versions ------------------------------------------
    const versionMap = new Map<string, string>();
    await sequelize.transaction(async (t) => {
      const rows: unknown[][] = [];
      for (const v of bootstrap.contextCatalogVersions) {
        const catalogCode = str(v.catalogCode);
        const catalogId = catalogCode ? catalogMap.get(catalogCode) : undefined;
        if (!catalogId) {
          throw new Error(`context_catalog_versions: no se pudo resolver catalog_id para catalogCode="${catalogCode}"`);
        }
        rows.push([
          catalogId,
          str(v.versionCode),
          str(v.status),
          str(v.validFrom),
          str(v.validUntil),
          str(v.createdByType),
          str(v.approvedByType),
          str(v.approvedAt),
          str(v.notes),
          RUN_TIMESTAMP,
        ]);
      }
      const returned = await upsertBatch(
        sequelize,
        'context_catalog_versions',
        ['catalog_id', 'version_code', 'status', 'valid_from', 'valid_until', 'created_by_type', 'approved_by_type', 'approved_at', 'notes', '_created_at'],
        ['catalog_id', 'version_code'],
        'catalog_id IS NOT NULL AND version_code IS NOT NULL',
        ['status', 'valid_from', 'valid_until', 'created_by_type', 'approved_by_type', 'approved_at', 'notes'],
        rows,
        t,
        ['_id', 'catalog_id', 'version_code'],
      );
      for (const r of returned) versionMap.set(`${r.catalog_id}::${r.version_code}`, String(r._id));
    });
    console.log(`[3/7] context_catalog_versions: ${versionMap.size} filas`);

    function resolveVersionId(catalogCode: string, versionCode: string): string {
      const catalogId = catalogMap.get(catalogCode);
      if (!catalogId) throw new Error(`No se pudo resolver catalog_id para catalogCode="${catalogCode}"`);
      const versionId = versionMap.get(`${catalogId}::${versionCode}`);
      if (!versionId) throw new Error(`No se pudo resolver catalog_version_id para catalogCode="${catalogCode}" versionCode="${versionCode}"`);
      return versionId;
    }

    // ---- 4) supporting + profile context_items (357 filas) --------------------
    const supporting = readJson<{ dimensionItems: JsonRecord[]; profileItems: JsonRecord[] }>(
      '02_normalized_reference/supporting_context_items_seed.json',
    );
    const profileItemMap = new Map<string, string>(); // `${catalogVersionId}::${itemCode}` -> _id
    await sequelize.transaction(async (t) => {
      const allItems = [...supporting.dimensionItems, ...supporting.profileItems];
      const rows: unknown[][] = [];
      for (const item of allItems) {
        const versionId = resolveVersionId(str(item.catalogCode)!, str(item.versionCode)!);
        const sourceId = item.sourceCode ? sourceMap.get(str(item.sourceCode)!) ?? null : null;
        rows.push([
          versionId,
          str(item.itemCode),
          str(item.itemName),
          str(item.itemType),
          jsonb(item.attributes),
          sourceId,
          str(item.confidenceScore),
          bool(item.isActive),
          RUN_TIMESTAMP,
          RUN_TIMESTAMP,
        ]);
      }
      const returned = await upsertBatch(
        sequelize,
        'context_items',
        ['catalog_version_id', 'item_code', 'item_name', 'item_type', 'attributes_json', 'source_id', 'confidence_score', 'is_active', '_created_at', '_updated_at'],
        ['catalog_version_id', 'item_code'],
        'catalog_version_id IS NOT NULL AND item_code IS NOT NULL',
        ['item_name', 'item_type', 'attributes_json', 'source_id', 'confidence_score', 'is_active', '_updated_at'],
        rows,
        t,
        ['_id', 'catalog_version_id', 'item_code'],
      );
      for (const r of returned) profileItemMap.set(`${r.catalog_version_id}::${r.item_code}`, String(r._id));
    });
    console.log(`[4/7] context_items (supporting + profile): ${profileItemMap.size} filas`);

    // ---- 5) 24 chunks de bindings materializados (1,200,000 filas) ------------
    const manifest = readJson<{ chunks: { catalogCode: string; relativePath: string; itemCount: number }[] }>(
      '00_manifest/database_seed_manifest.json',
    );
    const maxChunks = process.env.ATLAS_CONTEXT_SEED_MAX_CHUNKS
      ? Number(process.env.ATLAS_CONTEXT_SEED_MAX_CHUNKS)
      : manifest.chunks.length;
    let totalBindings = 0;
    for (let i = 0; i < Math.min(manifest.chunks.length, maxChunks); i += 1) {
      const chunk = manifest.chunks[i];
      const chunkStartedAt = Date.now();
      const data = readJson<{ catalogCode: string; versionCode: string; items: JsonRecord[] }>(chunk.relativePath);
      const versionId = resolveVersionId(data.catalogCode, data.versionCode);

      await sequelize.transaction(async (t) => {
        for (let offset = 0; offset < data.items.length; offset += CHUNK_BATCH_SIZE) {
          const slice = data.items.slice(offset, offset + CHUNK_BATCH_SIZE);
          const rows = slice.map((item) => {
            const sourceId = item.sourceCode ? sourceMap.get(str(item.sourceCode)!) ?? null : null;
            return [
              versionId,
              str(item.itemCode),
              str(item.itemName),
              str(item.itemType),
              jsonb(item.attributes),
              sourceId,
              str(item.confidenceScore),
              bool(item.isActive),
              RUN_TIMESTAMP,
              RUN_TIMESTAMP,
            ];
          });
          await upsertBatch(
            sequelize,
            'context_items',
            ['catalog_version_id', 'item_code', 'item_name', 'item_type', 'attributes_json', 'source_id', 'confidence_score', 'is_active', '_created_at', '_updated_at'],
            ['catalog_version_id', 'item_code'],
            'catalog_version_id IS NOT NULL AND item_code IS NOT NULL',
            ['item_name', 'item_type', 'attributes_json', 'source_id', 'confidence_score', 'is_active', '_updated_at'],
            rows,
            t,
          );
        }
      });

      totalBindings += data.items.length;
      const ms = Date.now() - chunkStartedAt;
      console.log(
        `[5/7] chunk ${i + 1}/${manifest.chunks.length} (${chunk.relativePath}) -> ${data.items.length} filas en ${ms}ms — acumulado ${totalBindings}`,
      );
    }

    // ---- 6) context_item_aliases (480 filas) -----------------------------------
    const aliasesFile = readJson<{ items: JsonRecord[] }>('02_normalized_reference/context_item_aliases_seed.json');
    let aliasCount = 0;
    await sequelize.transaction(async (t) => {
      const rows: unknown[][] = [];
      for (const a of aliasesFile.items) {
        const ref = a.contextItemRef as JsonRecord;
        const versionId = resolveVersionId(str(ref.catalogCode)!, str(ref.versionCode)!);
        const contextItemId = profileItemMap.get(`${versionId}::${str(ref.itemCode)}`);
        if (!contextItemId) {
          throw new Error(`context_item_aliases: no se pudo resolver context_item_id para ${JSON.stringify(ref)}`);
        }
        rows.push([contextItemId, str(a.aliasValue), str(a.aliasType), str(a.normalizedAlias), str(a.confidenceScore), RUN_TIMESTAMP]);
      }
      await upsertBatch(
        sequelize,
        'context_item_aliases',
        ['context_item_id', 'alias_value', 'alias_type', 'normalized_alias', 'confidence_score', '_created_at'],
        ['context_item_id', 'normalized_alias', 'alias_type'],
        'context_item_id IS NOT NULL AND normalized_alias IS NOT NULL AND alias_type IS NOT NULL',
        ['alias_value', 'confidence_score'],
        rows,
        t,
      );
      aliasCount = rows.length;
    });
    console.log(`[6/7] context_item_aliases: ${aliasCount} filas`);

    // ---- 7) context_risk_mappings (240 filas) ----------------------------------
    const riskFile = readJson<{ items: JsonRecord[] }>('02_normalized_reference/context_risk_mappings_seed.json');
    let riskCount = 0;
    await sequelize.transaction(async (t) => {
      const rows: unknown[][] = [];
      for (const r of riskFile.items) {
        const ref = r.contextItemRef as JsonRecord;
        const versionId = resolveVersionId(str(ref.catalogCode)!, str(ref.versionCode)!);
        const contextItemId = profileItemMap.get(`${versionId}::${str(ref.itemCode)}`);
        if (!contextItemId) {
          throw new Error(`context_risk_mappings: no se pudo resolver context_item_id para ${JSON.stringify(ref)}`);
        }
        rows.push([
          contextItemId,
          str(r.riskDimension),
          str(r.riskBand),
          str(r.scorePointsSuggested),
          str(r.reasonCode),
          str(r.explanation),
          str(r.modelUsage),
          str(r.validFrom),
          str(r.validUntil),
          RUN_TIMESTAMP,
        ]);
      }
      await upsertBatch(
        sequelize,
        'context_risk_mappings',
        ['context_item_id', 'risk_dimension', 'risk_band', 'score_points_suggested', 'reason_code', 'explanation', 'model_usage', 'valid_from', 'valid_until', '_created_at'],
        ['context_item_id', 'risk_dimension', 'risk_band', 'reason_code', 'valid_from'],
        'context_item_id IS NOT NULL AND risk_dimension IS NOT NULL AND risk_band IS NOT NULL AND reason_code IS NOT NULL',
        ['score_points_suggested', 'explanation', 'model_usage', 'valid_until'],
        rows,
        t,
      );
      riskCount = rows.length;
    });
    console.log(`[7/7] context_risk_mappings: ${riskCount} filas`);

    // ---- Reconciliación ---------------------------------------------------------
    const validation = readJson<{
      counts: {
        materializedContextBindings: number;
        supportingDimensionItems: number;
        profileDefinitionItems: number;
        aliases: number;
        riskMappings: number;
      };
    }>('07_validation/validation.json');

    const [{ total_items }] = (await sequelize.query('SELECT COUNT(*)::int AS total_items FROM context_items;', {
      type: QueryTypes.SELECT,
    })) as { total_items: number }[];
    const [{ total_aliases }] = (await sequelize.query('SELECT COUNT(*)::int AS total_aliases FROM context_item_aliases;', {
      type: QueryTypes.SELECT,
    })) as { total_aliases: number }[];
    const [{ total_risk }] = (await sequelize.query('SELECT COUNT(*)::int AS total_risk FROM context_risk_mappings;', {
      type: QueryTypes.SELECT,
    })) as { total_risk: number }[];

    const expectedItems =
      validation.counts.materializedContextBindings + validation.counts.supportingDimensionItems + validation.counts.profileDefinitionItems;

    console.log('---- Reconciliación ----');
    console.log(`context_items:        actual=${total_items} esperado>=${expectedItems} -> ${total_items >= expectedItems ? 'PASS' : 'FAIL'}`);
    console.log(`context_item_aliases: actual=${total_aliases} esperado>=${validation.counts.aliases} -> ${total_aliases >= validation.counts.aliases ? 'PASS' : 'FAIL'}`);
    console.log(`context_risk_mappings: actual=${total_risk} esperado>=${validation.counts.riskMappings} -> ${total_risk >= validation.counts.riskMappings ? 'PASS' : 'FAIL'}`);

    const totalMs = Date.now() - startedAt;
    console.log(`OK: inyección completa en ${(totalMs / 1000).toFixed(1)}s`);
  } finally {
    await sequelize.close();
  }
}

main().catch((error: unknown) => {
  console.error('FALLÓ la inyección de seeds:', error);
  process.exit(1);
});
