/**
 * Carga el mapa de FLUJOS (artefacto de AtlasFlowIntelligence, `flow-model/`) en el catálogo de
 * sistemas SIN HTTP y sin sesión: llama al mismo `SystemFlowsImportService` que `POST
 * /systems/flows/import/*`, con los mismos cuerpos que arma `tools/load.mjs`.
 *
 * Existe porque en TEST las pantallas de Flujos estaban vacías (medido el 2026-09-28:
 * `system_flow_catalog`, `system_screen_catalog`, `system_flow_findings` y `system_flow_imports` a 0):
 * la única vía de carga era `tools/load.mjs`, que inicia sesión con usuario, contraseña y PIN
 * por correo, y nadie la había corrido contra ese entorno.
 *
 * Las comprobaciones del servicio siguen valiendo: el esquema (Zod) valida cada cuerpo, un
 * artefacto más viejo que el último cargado se rechaza, y retirar flujos con revisiones humanas
 * exige confirmarlo. Un bloque que falla no frena a los demás; al final se dice cuáles fallaron.
 *
 * El artefacto viaja en la imagen como `ops/flow-model/flow-model.json.gz` (manifiesto + endpoints,
 * pantallas y hallazgos de cada bloque; ~235 KB): el job `migrate` lo carga en cada despliegue. Se
 * regenera con `yarn flows:pack <ruta a flow-model/>` tras correr `derive` en AtlasFlowIntelligence.
 *
 * Uso (desde JavaScript compilado):
 *   node dist/scripts/import-flow-model.js [--only ATLAS_BACKEND,ADMIN_PORTAL]
 *   FLOW_MODEL_DIR=/ruta/a/flow-model node dist/scripts/import-flow-model.js   # desde la carpeta sin empaquetar
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';

type Json = Record<string, unknown>;

/** Bloque del artefacto → repositorio del que salió (el manifiesto guarda commit y rama por repositorio). */
const REPO_OF: Record<string, string> = {
  ATLAS_BACKEND: 'AtlasBackend',
  DECISION_ENGINE: 'AtlasDecisionEngineBackend',
  ERP_BACKEND: 'AtlasERPBackend',
  DASHBOARDS: 'AtlasDashboardsBackend',
  ADMIN_PORTAL: 'AtlasAdminPortal',
  MOTOR_PORTAL: 'AtlasDecisionEngineFrontend',
  ERP_PORTAL: 'AtlasERPFrontend',
  DASHBOARDS_PORTAL: 'AtlasDashboardsFrontend',
  CONSUMER_APP: 'AtlasFrontend/apps/consumer-app',
};

const readJson = <T = unknown>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

type Manifest = {
  generatedAt: string;
  contentHash?: string;
  counts?: Record<string, Record<string, number>>;
  repos?: Record<string, { commit?: string; branch?: string }>;
};
type FlowModel = { manifest: Manifest; blocks: Record<string, { endpoints?: unknown; screens?: unknown; findings?: unknown }> };

const SCOPES = ['endpoints', 'screens', 'findings'] as const;

/** Lee el mapa de la carpeta `flow-model/` (FLOW_MODEL_DIR) o del paquete comprimido de la imagen. */
function loadModel(): FlowModel {
  const dir = process.env.FLOW_MODEL_DIR;
  if (dir) {
    if (!existsSync(join(dir, 'manifest.json'))) throw new Error(`${dir} no tiene manifest.json.`);
    const blocks: FlowModel['blocks'] = {};
    for (const code of readdirSync(dir).filter((entry) => existsSync(join(dir, entry, 'derived')))) {
      blocks[code] = {};
      for (const scope of SCOPES) {
        const file = join(dir, code, 'derived', `${scope}.json`);
        if (existsSync(file)) blocks[code][scope] = readJson(file);
      }
    }
    return { manifest: readJson<Manifest>(join(dir, 'manifest.json')), blocks };
  }
  const bundle = process.env.FLOW_MODEL_BUNDLE ?? join(process.cwd(), 'ops', 'flow-model', 'flow-model.json.gz');
  if (!existsSync(bundle)) throw new Error(`No está el paquete de flujos en ${bundle}.`);
  return JSON.parse(gunzipSync(readFileSync(bundle)).toString('utf8')) as FlowModel;
}

async function main(): Promise<void> {
  process.env.DATABASE_SEED_ON_STARTUP = 'false';
  const model = loadModel();
  const only = argValue('--only')
    ?.split(',')
    .map((code) => code.trim());
  const { manifest } = model;

  const { AppModule } = await import('../src/app.module.js');
  const { SystemFlowsImportService } = await import('../src/modules/systems-ops/system-flows.import.service.js');
  const { importEndpointsSchema, importScreensSchema, importFindingsSchema } =
    await import('../src/modules/systems-ops/system-flows.schemas.js');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'], abortOnError: false });
  const service = app.get(SystemFlowsImportService);
  const declared = (code: string, scope: string): number => {
    const count = manifest.counts?.[code]?.[scope];
    if (!Number.isInteger(count)) throw new Error(`el manifiesto no declara cuántos ${scope} tiene ${code}`);
    return count as number;
  };
  const edad = { artifactGeneratedAt: manifest.generatedAt };
  const report: Array<{ code: string; scope: string; result: string }> = [];

  const codes = Object.keys(model.blocks).filter((code) => !only || only.includes(code));

  try {
    for (const code of codes) {
      const block = model.blocks[code] ?? {};
      const git = manifest.repos?.[REPO_OF[code] ?? code] ?? {};
      const run = async (scope: string, work: () => Promise<unknown>): Promise<boolean> => {
        try {
          const result = await work();
          report.push({ code, scope, result: JSON.stringify(result).slice(0, 160) });
          return true;
        } catch (error) {
          report.push({ code, scope, result: `ERROR: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300) });
          return false;
        }
      };

      if (block.endpoints) {
        const ok = await run('endpoints', () => {
          const endpoints = (block.endpoints as Json[]).map((e) => ({
            method: e.method,
            path: e.path,
            module: e.module,
            controller: e.controller,
            handler: e.handler,
            file: e.file,
            line: e.line,
            isPublic: e.isPublic,
            roles: e.roles,
            internalPermissions: e.internalPermissions,
            guards: e.guards,
            callers: e.callers,
            testStatus: e.testStatus,
            contractStatus: e.contractStatus ?? 'NO_CONTRACT',
            analysis: e.analysis,
          }));
          const body = importEndpointsSchema.parse({
            systemCode: code,
            analyzedCommit: git.commit ?? undefined,
            analyzedBranch: git.branch ?? undefined,
            contentHash: manifest.contentHash?.slice(0, 64),
            endpoints,
            declaredCount: declared(code, 'endpoints'),
            allowRemovingDecisions: false,
            ...edad,
          });
          return service.importEndpoints(body, null);
        });
        if (!ok) continue;
      }
      if (block.screens) {
        const ok = await run('screens', () => {
          const screens = (block.screens as { screens: Json[] }).screens.map((s) => ({
            route: s.route,
            file: s.file,
            navLabel: s.navLabel ?? null,
            navPermissions: s.navPermissions ?? [],
            navRoles: s.navRoles ?? [],
          }));
          const body = importScreensSchema.parse({
            clientCode: code,
            analyzedCommit: git.commit ?? undefined,
            screens,
            declaredCount: declared(code, 'screens'),
            allowRemovingMenuGates: [],
            ...edad,
          });
          return service.importScreens(body, null);
        });
        if (!ok) continue;
      }
      if (block.findings) {
        await run('findings', () => {
          const base = ['kind', 'severity', 'systemCode', 'ref', 'module', 'summary', 'knownSince'];
          const findings = (block.findings as Json[]).map((f) => ({
            kind: f.kind,
            severity: f.severity,
            systemCode: f.systemCode,
            ref: f.ref,
            module: f.module,
            summary: f.summary,
            knownSince: f.knownSince,
            extra: Object.fromEntries(Object.entries(f).filter(([key]) => !base.includes(key))),
          }));
          const body = importFindingsSchema.parse({
            systemCode: code,
            analyzedCommit: git.commit ?? undefined,
            findings,
            declaredCount: declared(code, 'findings'),
            ...edad,
          });
          return service.importFindings(body, null);
        });
      }
    }
  } finally {
    await app.close();
  }

  console.table(report);
  const failed = report.filter((row) => row.result.startsWith('ERROR'));
  if (failed.length) {
    console.error(`❌ ${failed.length} carga(s) de flujos fallaron; el resto quedó cargado.`);
    process.exitCode = 1;
  } else {
    console.log(`✅ Flujos cargados: ${report.length} cargas de ${codes.length} bloques (artefacto del ${manifest.generatedAt}).`);
  }
}

main().catch((error: unknown) => {
  console.error('❌ No se pudo cargar el mapa de flujos.', error);
  process.exit(1);
});
