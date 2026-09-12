/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define context-seed para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  assertArray,
  assertRecord,
  readJson,
  requireString,
  resolvePackageFile,
  validateHeader,
  validateItem,
} from './context-seed-validation.js';
import { aliasRows, itemRows, riskRows } from './context-seed-rows.js';
import { UPSERT_ALIASES_SQL, UPSERT_ITEMS_SQL, UPSERT_RISK_MAPPINGS_SQL } from './context-seed-upserts.constants.js';
import { checkpointMatches, loadBootstrap, saveCheckpoint, upsertBatches } from './context-seed-writer.js';
import type {
  BootstrapSeed,
  ContextSeedLoadOptions,
  ContextSeedLoadReport,
  ItemsSeed,
  JsonRecord,
  PackageEntrypoint,
  PackageManifest,
  ReferenceSeed,
  SupportingSeed,
} from './context-seed.types.js';

export type { ContextSeedLoadOptions, ContextSeedLoadReport } from './context-seed.types.js';
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
       FROM catalog.context_items i
       JOIN catalog.context_catalog_versions v ON v._id = i.catalog_version_id
       JOIN catalog.context_catalogs c ON c._id = v.catalog_id
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
       FROM catalog.context_items i
       JOIN catalog.context_catalog_versions v ON v._id = i.catalog_version_id
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
     FROM catalog.context_catalog_versions v
     JOIN catalog.context_items i ON i.catalog_version_id = v._id
     LEFT JOIN catalog.context_item_aliases a ON a.context_item_id = i._id
     LEFT JOIN catalog.context_risk_mappings r ON r.context_item_id = i._id
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
