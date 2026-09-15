/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system escribe el paquete por lotes y registra los checkpoints de cada chunk.
 */
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { UPSERT_CATALOGS_SQL, UPSERT_SOURCES_SQL, UPSERT_VERSIONS_SQL } from './context-seed-upserts.constants.js';
import { catalogRows, sourceRows, versionRows } from './context-seed-rows.js';
import type { BootstrapSeed, JsonRecord, ManifestChunk } from './context-seed.types.js';

/** Tamaño del lote: un upsert por cada 1000 filas, no uno por fila ni uno por paquete. */
export const BATCH_SIZE = 1_000;

export function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export async function affectedRows(sequelize: Sequelize, sql: string, rows: JsonRecord[], transaction: Transaction): Promise<number> {
  const result = await sequelize.query<{ affected: number }>(sql, {
    bind: { rows: JSON.stringify(rows) },
    transaction,
    type: QueryTypes.SELECT,
  });
  return Number(result[0]?.affected ?? 0);
}

export async function upsertBatches(
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

export async function loadBootstrap(sequelize: Sequelize, bootstrap: BootstrapSeed): Promise<void> {
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

export async function checkpointMatches(
  sequelize: Sequelize,
  chunk: ManifestChunk,
  sha256: string,
  transaction: Transaction,
): Promise<boolean> {
  const rows = await sequelize.query<{ content_sha256: string }>(
    `SELECT content_sha256
       FROM catalog.context_seed_import_checkpoints
      WHERE catalog_code = $catalogCode AND relative_path = $relativePath AND item_count = $itemCount`,
    {
      bind: { catalogCode: chunk.catalogCode, relativePath: chunk.relativePath, itemCount: chunk.itemCount },
      transaction,
      type: QueryTypes.SELECT,
    },
  );
  return rows[0]?.content_sha256 === sha256;
}

export async function saveCheckpoint(
  sequelize: Sequelize,
  packageBuildVersion: string,
  chunk: ManifestChunk,
  sha256: string,
  transaction: Transaction,
): Promise<void> {
  await sequelize.query(
    `INSERT INTO catalog.context_seed_import_checkpoints
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
