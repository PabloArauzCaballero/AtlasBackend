/**
 * Empaqueta el artefacto de Flujos de AtlasFlowIntelligence (`flow-model/`) en
 * `ops/flow-model/flow-model.json.gz`: manifiesto + endpoints, pantallas y hallazgos de cada bloque.
 * Es lo que el job `migrate` carga con `scripts/import-flow-model.ts` en cada despliegue.
 *
 * Uso: yarn flows:pack ../AtlasFlowIntelligence/flow-model
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const dir = resolve(process.argv[2] ?? '../AtlasFlowIntelligence/flow-model');
if (!existsSync(join(dir, 'manifest.json'))) {
  console.error(`❌ ${dir} no tiene manifest.json: pásale la carpeta flow-model/ de AtlasFlowIntelligence.`);
  process.exit(1);
}
const readJson = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
const manifest = readJson(join(dir, 'manifest.json'));
const blocks: Record<string, Record<string, unknown>> = {};
for (const code of readdirSync(dir).filter((entry) => existsSync(join(dir, entry, 'derived')))) {
  blocks[code] = {};
  for (const scope of ['endpoints', 'screens', 'findings']) {
    const file = join(dir, code, 'derived', `${scope}.json`);
    if (existsSync(file)) blocks[code][scope] = readJson(file);
  }
}
const { generatedAt, contentHash, counts, repos } = manifest;
const out = resolve('ops/flow-model/flow-model.json.gz');
mkdirSync(resolve('ops/flow-model'), { recursive: true });
writeFileSync(out, gzipSync(JSON.stringify({ manifest: { generatedAt, contentHash, counts, repos }, blocks }), { level: 9 }));
console.log(`✅ ${out}: ${Object.keys(blocks).length} bloques, artefacto del ${generatedAt}.`);
