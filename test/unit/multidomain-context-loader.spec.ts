import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMultidomainContextPackage } from '../../src/database/context-seed/multidomain-context-loader.js';

const roots: string[] = [];

async function writeJson(path: string, value: unknown): Promise<number> {
  const content = JSON.stringify(value);
  await writeFile(path, content, 'utf8');
  return Buffer.byteLength(content);
}

async function createPackage(itemOverride: Record<string, unknown> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'atlas-context-seed-'));
  roots.push(root);
  for (const directory of ['00_manifest', '01_bootstrap_seed', '02_normalized_reference', '03_database_seed_natural_keys']) {
    await mkdir(join(root, directory));
  }

  const item = {
    catalogCode: 'test.context',
    versionCode: 'preprod-test-v1',
    itemCode: 'CTX.TEST.1',
    itemName: 'Test context',
    itemType: 'context_binding',
    attributes: { publicationScope: 'preproduction_reference' },
    sourceCode: 'TEST_SOURCE',
    confidenceScore: '90.00',
    isActive: true,
    ...itemOverride,
  };
  const chunk = {
    schemaVersion: '2.0.0',
    catalogCode: 'test.context',
    versionCode: 'preprod-test-v1',
    loadingStrategy: 'natural_key_upsert',
    count: 1,
    items: [item],
  };
  const relativePath = '03_database_seed_natural_keys/chunk.json';
  const bytes = await writeJson(join(root, '03_database_seed_natural_keys', 'chunk.json'), chunk);

  await writeJson(join(root, 'ATLAS_CONTEXT_SEED_ENTRYPOINT.json'), {
    package: {
      buildVersion: 'test-build',
      environmentScope: 'preproduction',
      status: 'PASS',
      primaryDataCount: 1,
    },
  });
  await writeJson(join(root, '00_manifest', 'database_seed_manifest.json'), {
    schemaVersion: '2.0.0',
    loadingStrategy: 'natural_key_upsert',
    totalItems: 1,
    chunkCount: 1,
    chunks: [{ catalogCode: 'test.context', relativePath, itemCount: 1, bytes }],
  });
  await writeJson(join(root, '01_bootstrap_seed', 'bootstrap_seed.json'), {
    schemaVersion: '2.0.0',
    environmentScope: 'preproduction',
    loadingStrategy: 'natural_key_upsert',
    contextSources: [],
    contextCatalogs: [],
    contextCatalogVersions: [],
  });
  await writeJson(join(root, '02_normalized_reference', 'supporting_context_items_seed.json'), {
    schemaVersion: '2.0.0',
    versionCode: 'preprod-test-v1',
    dimensionItems: [],
    profileItems: [],
  });
  await writeJson(join(root, '02_normalized_reference', 'context_item_aliases_seed.json'), { count: 0, items: [] });
  await writeJson(join(root, '02_normalized_reference', 'context_risk_mappings_seed.json'), { count: 0, items: [] });
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('loadMultidomainContextPackage dry-run', () => {
  it('valida un paquete natural-key sin tocar la base', async () => {
    const packageDirectory = await createPackage();
    const report = await loadMultidomainContextPackage({ packageDirectory, dryRun: true, log: () => undefined });

    expect(report).toEqual(
      expect.objectContaining({
        packageBuildVersion: 'test-build',
        chunksLoaded: 1,
        materializedItems: 1,
        dryRun: true,
      }),
    );
  });

  it('rechaza IDs numericos importados aunque esten anidados', async () => {
    const packageDirectory = await createPackage({ attributes: { source_id: 99 } });

    await expect(loadMultidomainContextPackage({ packageDirectory, dryRun: true, log: () => undefined })).rejects.toThrow(
      'identificador importado prohibido source_id',
    );
  });
});
