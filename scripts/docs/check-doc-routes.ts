/**
 * @file Gate: toda ruta `MÉTODO /ruta` que citan los documentos de contrato, gobierno y endpoints existe.
 * @business La matriz de trazabilidad y el catálogo de flujos citaban rutas que no existían
 *   (`POST /risk/evaluations`, `POST /credit/applications`, `GET /workflows/customer_credit_journey`…): un
 *   integrador o un auditor que las sigue encuentra un 404, y la trazabilidad no traza nada.
 * @system `yarn check:doc-routes` compara cada span de código que EMPIEZA por `GET|POST|PUT|PATCH|DELETE /…`
 *   con `docs/endpoints/openapi.yaml` y con las rutas montadas fuera del contrato (`@ApiExcludeController`).
 *
 * Reglas:
 *  - `:id`, `{id}` y `<id>` son el mismo segmento variable, se llame como se llame; `/api/v1` delante se ignora.
 *  - Una ruta que termina en `/*`, `/...` o `/…` es un PREFIJO: vale si alguna ruta real empieza así.
 *  - Una ruta de OTRO servicio (ERP, Motor) se escribe con el servicio dentro del span delante del método
 *    (`Motor · POST /v1/…`) o fuera de él: así no se confunde con una ruta de Core.
 *
 * Alcance: `docs/api`, `docs/endpoints`, `docs/governance`, `docs/security` y `docs/events` (contrato,
 * gobierno y endpoints). Fuera, deliberadamente: `docs/processes` (generado por `yarn docs:processes` y
 * con rutas del ERP y del Motor en sus pasos), `docs/runbooks`, `docs/architecture` y el resto, con
 * ejemplos ilustrativos (`POST /api/v1/...`). Ampliar el alcance es añadir la carpeta a `SCOPE`.
 */
import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { loadControllerRoutes, routeShape } from './lib/controller-routes.js';
import { referenceExists, routeReference } from './lib/doc-markers.js';
import { codeSnippets, trackedMarkdown } from './lib/markdown.js';

const SCOPE = ['docs/api/', 'docs/endpoints/', 'docs/governance/', 'docs/security/', 'docs/events/'];
async function knownRoutes(): Promise<Set<string>> {
  const contract = yaml.load(readFileSync('docs/endpoints/openapi.yaml', 'utf8')) as { paths: Record<string, Record<string, unknown>> };
  const known = new Set(
    Object.entries(contract.paths).flatMap(([path, operations]) =>
      Object.keys(operations).map((method) => `${method.toUpperCase()} ${routeShape(path)}`),
    ),
  );
  const { routes } = await loadControllerRoutes();
  for (const route of routes.filter((candidate) => candidate.excludedFromContract)) known.add(`${route.method} ${routeShape(route.path)}`);
  return known;
}

async function main(): Promise<void> {
  const known = await knownRoutes();
  const problems: string[] = [];
  let checked = 0;
  for (const file of trackedMarkdown({ include: SCOPE })) {
    for (const snippet of codeSnippets(readFileSync(file, 'utf8')).filter((candidate) => candidate.inline)) {
      const reference = routeReference(snippet.code);
      if (!reference) continue;
      checked += 1;
      if (!referenceExists(reference, known)) problems.push(`${file}:${snippet.line}: \`${snippet.code}\` no existe en Core`);
    }
  }
  if (problems.length > 0) {
    console.error(`❌ ${problems.length} ruta(s) citada(s) en la documentación no existen (alcance: ${SCOPE.join(', ')}):`);
    problems.forEach((problem) => console.error(`   - ${problem}`));
    console.error(
      '   Cítala como la expone docs/endpoints/openapi.yaml, o, si es de otro servicio, con el servicio delante (`Motor · POST /v1/…`).',
    );
    process.exit(1);
  }
  console.log(`✅ ${checked} ruta(s) citada(s) en ${SCOPE.join(', ')} existen en Core.`);
}

main().catch((error: unknown) => {
  console.error('❌ No se pudieron comprobar las rutas de la documentación.', error);
  process.exit(1);
});
