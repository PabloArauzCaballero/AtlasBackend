/**
 * @file Genera `docs/security/admin-rbac-matrix.md` desde la metadata de los controladores.
 * @business Quién puede llamar a cada ruta, dicho por el mismo dato que aplican los guards.
 * @system `yarn docs:rbac-matrix` escribe; `yarn check:rbac-matrix` (CI) falla si el versionado difiere.
 *
 * La matriz anterior se escribía a mano, decía «generada a partir del código» y no lo estaba: faltaban
 * ~23 prefijos de controlador y afirmaba que una ruta sin fila era pública (falso: casi todas llevan
 * `@Roles`). Ésta sale de `loadControllerRoutes()`, que lee `@Roles`, `@InternalPermissions`,
 * `@Public`, `@ServiceScope`, `@SignedEventSource` y `@UseGuards` con la regla de los guards
 * (`getAllAndOverride([handler, class])`). Hermano de `check-auth-coverage.ts`: aquél congela la
 * superficie abierta por archivo; éste la enseña ruta a ruta.
 */
import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { loadControllerRoutes, routeShape, type ControllerRoute } from './lib/controller-routes.js';
import { writeOrCheck } from './lib/generated-file.js';

const OUTPUT = 'docs/security/admin-rbac-matrix.md';

/**
 * Guards que hacen cumplir `@InternalPermissions`. `SchemaChangeAuthorizationGuard` delega en
 * `InternalPermissionsGuard` para sesiones internas (ver `schema-change-authorization.guard.ts`). Un
 * permiso declarado sin ninguno de éstos es metadata muerta: el generador falla en vez de listarlo.
 */
const PERMISSION_GUARDS = ['InternalPermissionsGuard', 'SchemaChangeAuthorizationGuard'];

/** Guards que Nest ya aplica a TODAS las rutas (`APP_GUARD` en `app.module.ts`): no aportan a la fila. */
const GLOBAL_GUARDS = ['JwtAuthGuard', 'RolesGuard', 'ThrottlerGuard'];

function access(route: ControllerRoute): string {
  if (route.signedEventSource) return `evento firmado por \`${route.signedEventSource}\` (HMAC)`;
  if (route.serviceScope) return `identidad de servicio \`${JSON.stringify(route.serviceScope)}\``;
  if (route.isPublic) {
    return route.guards.includes('EngineCallbackKeyGuard')
      ? 'sin sesión · clave del Motor (`x-engine-callback-key`)'
      : '**sin sesión** (`@Public`)';
  }
  if (route.roles.length > 0) return route.roles.map((role) => `\`${role}\``).join(', ');
  return 'cualquier sesión autenticada';
}

function moduleOf(file: string): string {
  const match = /^src\/modules\/([^/]+)\//.exec(file);
  return match ? match[1] : file.split('/').slice(0, 3).join('/');
}

function row(route: ControllerRoute): string {
  const permissions = route.internalPermissions.map((code) => `\`${code}\``).join(', ') || '—';
  const guards = route.guards.filter((guard) => !GLOBAL_GUARDS.includes(guard));
  const notes = [
    ...(guards.length > 0 ? [`guards: ${guards.map((guard) => `\`${guard}\``).join(', ')}`] : []),
    ...(route.excludedFromContract ? ['fuera del contrato OpenAPI'] : []),
  ].join(' · ');
  return `| \`${route.method}\` | \`${route.path}\` | ${access(route)} | ${permissions} | \`${route.controller}.${route.handler}\` | ${notes || '—'} |`;
}

function assertPermissionsEnforced(routes: readonly ControllerRoute[]): void {
  const dead = routes.filter(
    (route) => route.internalPermissions.length > 0 && !route.guards.some((guard) => PERMISSION_GUARDS.includes(guard)),
  );
  if (dead.length === 0) return;
  console.error('❌ Rutas con @InternalPermissions sin un guard que lo haga cumplir (metadata muerta):');
  dead.forEach((route) => console.error(`   - ${route.method} ${route.path} (${route.file})`));
  process.exit(1);
}

/** Toda ruta montada y no excluida del contrato debe estar en el OpenAPI versionado, y viceversa. */
function assertMatchesContract(routes: readonly ControllerRoute[]): void {
  const contract = yaml.load(readFileSync('docs/endpoints/openapi.yaml', 'utf8')) as { paths: Record<string, Record<string, unknown>> };
  const inContract = new Set(
    Object.entries(contract.paths).flatMap(([path, operations]) =>
      Object.keys(operations).map((method) => `${method.toUpperCase()} ${routeShape(path)}`),
    ),
  );
  const mounted = new Set(
    routes.filter((route) => !route.excludedFromContract).map((route) => `${route.method} ${routeShape(route.path)}`),
  );
  const missing = [...mounted].filter((key) => !inContract.has(key));
  const extra = [...inContract].filter((key) => !mounted.has(key));
  if (missing.length === 0 && extra.length === 0) return;
  console.error('❌ Los controladores y docs/endpoints/openapi.yaml no coinciden. Corre "yarn docs:openapi" (en tu worktree):');
  missing.forEach((key) => console.error(`   - montada y ausente del contrato: ${key}`));
  extra.forEach((key) => console.error(`   - en el contrato y no montada: ${key}`));
  process.exit(1);
}

function summary(routes: readonly ControllerRoute[], controllers: number): string[] {
  const count = (predicate: (route: ControllerRoute) => boolean): number => routes.filter(predicate).length;
  const service = (route: ControllerRoute): boolean => Boolean(route.signedEventSource || route.serviceScope);
  const open = (route: ControllerRoute): boolean => route.isPublic && !service(route);
  return [
    '| Superficie | Rutas |',
    '|---|---:|',
    `| Total montadas (${controllers} controladores) | ${routes.length} |`,
    `| Fuera del contrato OpenAPI (\`@ApiExcludeController\`/\`@ApiExcludeEndpoint\`) | ${count((route) => route.excludedFromContract)} |`,
    `| Sin sesión de usuario (\`@Public\`) | ${count(open)} |`,
    `| Credencial de servicio (\`@ServiceScope\` / \`@SignedEventSource\`) | ${count(service)} |`,
    `| Con \`@Roles\` | ${count((route) => !open(route) && !service(route) && route.roles.length > 0)} |`,
    `| Con permiso fino \`@InternalPermissions\` (además del rol) | ${count((route) => route.internalPermissions.length > 0)} |`,
    `| Cualquier sesión autenticada (sin \`@Roles\`) | ${count((route) => !open(route) && !service(route) && route.roles.length === 0)} |`,
  ];
}

const HEADER = [
  '# Matriz de roles y permisos — AtlasBackend',
  '',
  '> **Generada.** No se edita a mano: `yarn docs:rbac-matrix` la escribe desde la metadata de los',
  '> controladores y `yarn check:rbac-matrix` (CI, job `contract-and-docs`) falla si el archivo versionado',
  '> difiere del código. Fuente: `scripts/docs/generate-rbac-matrix.ts`.',
  '',
  '## Cómo se lee',
  '',
  '- **Acceso** es lo que exige `RolesGuard` (global, `APP_GUARD`) con la regla `getAllAndOverride([handler, clase])`:',
  '  el `@Roles` del método manda sobre el de la clase. `JwtAuthGuard` también es global: **toda ruta exige',
  '  sesión salvo las marcadas `@Public`**. No hay rutas públicas por omisión; una ruta que no aparece aquí no existe.',
  '- **Permiso fino** (`@InternalPermissions`) se exige **además** del rol, sólo a sesiones internas, y lo hace',
  '  cumplir el guard que figura en *Notas* (`InternalPermissionsGuard` o `SchemaChangeAuthorizationGuard`,',
  '  que delega en él). El generador falla si una ruta declara un permiso sin guard que lo aplique.',
  '- **Sin sesión** no siempre es «abierta»: varias rutas `@Public` comprueban otra credencial (clave del Motor,',
  '  firma del proveedor de notificaciones, token de un solo uso). Las que la comprueban con un guard lo dicen',
  '  en *Acceso* o en *Notas*; las que la comprueban dentro del handler están congeladas por',
  '  `yarn check:auth-coverage` (`.auth-coverage-baseline.json`).',
  '- **Tenant**: `TenantGuard` exige que el `x-tenant-id` coincida con el `tenantId` del token (salvo',
  '  `platform_user`); ver `src/common/guards/tenant.guard.ts`.',
  '- Las rutas van sin el prefijo global `/api/v1`.',
  '',
];

async function main(): Promise<void> {
  const { routes, controllers } = await loadControllerRoutes();
  assertPermissionsEnforced(routes);
  assertMatchesContract(routes);
  const modules = [...new Set(routes.map((route) => moduleOf(route.file)))].sort();
  const lines = [...HEADER, '## Resumen', '', ...summary(routes, controllers), ''];
  for (const name of modules) {
    const own = routes.filter((route) => moduleOf(route.file) === name);
    lines.push(`## \`${name}\``, '', '| Método | Ruta | Acceso | Permiso fino | Handler | Notas |', '|---|---|---|---|---|---|');
    lines.push(...own.map(row), '');
  }
  writeOrCheck([{ path: OUTPUT, content: `${lines.join('\n').trimEnd()}\n` }], 'yarn docs:rbac-matrix');
}

main().catch((error: unknown) => {
  console.error('❌ No se pudo generar la matriz de permisos.', error);
  process.exit(1);
});
