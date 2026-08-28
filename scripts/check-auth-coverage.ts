/**
 * Gate estático: la superficie SIN sesión y SIN rol no puede crecer en silencio (ATL-003).
 *
 * ## Qué pasó
 *
 * Este backend autenticaba por opt-in: el único guard global era el de rate limiting, así que una
 * ruta quedaba protegida sólo si su controlador escribía `@UseGuards(JwtAuthGuard, ...)`. Dos no lo
 * hicieron. No eran rutas menores: una servía el carnet y la selfie de cualquier cliente
 * (`customer-evidence-view.controller.ts`) y la otra reasignaba qué artefacto decide crédito,
 * identidad y riesgo (`decision-artifact-binding.controller.ts`). Las DOS declaraban
 * `@Roles(...)` — que sin guard que la lea es metadata muerta, no una protección.
 *
 * Registrar `JwtAuthGuard` como `APP_GUARD` (ver `app.module.ts`) arregla esos dos casos y hace que
 * un controlador nuevo nazca cerrado. Pero por sí solo no impide la recaída por el otro lado: a
 * partir de ahora abrir una ruta es escribir `@Public()`, y `@Public()` es una línea que se cuela
 * en una revisión con la misma facilidad con la que antes se olvidaba `@UseGuards`.
 *
 * ## Qué congela este gate
 *
 * Dos superficies, cada una con su piso:
 *
 *  1. **Rutas públicas** (`@Public()`): las que hay hoy están en el baseline. Una más, en cualquier
 *     archivo, falla el build. Abrir una ruta pasa a ser una decisión que alguien firma al bajar el
 *     baseline, no un efecto colateral.
 *
 *  2. **Controladores sin regla de autorización**: tienen sesión pero cualquier rol autenticado
 *     entra, porque no declaran `@Roles`, `@InternalPermissions` ni un decorador compuesto que los
 *     aplique. Varios son legítimos (el propio login, el cambio de contraseña de la sesión en
 *     curso); otros son deuda. Se congelan igual: la lista no puede crecer.
 *
 * Mismo espíritu que `check-tenant-header-usage.ts` y `check-file-size.ts`: la deuda conocida se
 * documenta y se congela; la deuda nueva se bloquea.
 *
 *   yarn check:auth-coverage
 *   yarn check:auth-coverage --update-baseline   # tras abrir/cerrar una ruta a propósito
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC_DIR = resolve(process.cwd(), 'src');
const BASELINE_PATH = resolve(process.cwd(), '.auth-coverage-baseline.json');

const PUBLIC_DECORATOR = /@Public\(\)/g;
const ROUTE_DECORATOR = /@(Get|Post|Put|Patch|Delete)\s*\(/g;

/**
 * Lo que cuenta como «este controlador declara quién puede entrar».
 *
 * `SystemsOpsControllerSecurity` está en la lista porque es un decorador compuesto que aplica
 * `UseGuards` + `Roles` (ver `modules/systems-ops/systems-controller.decorators.ts`): buscar sólo
 * `@Roles(` daría 8 falsos positivos que están perfectamente protegidos, y un gate con falsos
 * positivos se acaba desactivando.
 */
const AUTHORIZATION_MARKERS = [/@Roles\s*\(/, /@InternalPermissions\s*\(/, /@SystemsOpsControllerSecurity\s*\(/];

interface Baseline {
  /** archivo -> nº de rutas `@Public()` aceptadas hoy. */
  publicRoutes: Record<string, number>;
  /** archivos de controlador que hoy no declaran ninguna regla de autorización. */
  controllersWithoutAuthorization: string[];
}

function controllerFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) controllerFiles(full, found);
    // Los `.spec.ts` quedan fuera: una prueba puede declarar un controlador de mentira para
    // ejercitar un guard, y contarlo como superficie real sería ruido puro.
    else if (entry.endsWith('.controller.ts') && !entry.endsWith('.spec.ts')) found.push(full);
  }
  return found;
}

function relativePath(file: string): string {
  return relative(process.cwd(), file).replace(/\\/g, '/');
}

function scan(): Baseline {
  const publicRoutes: Record<string, number> = {};
  const controllersWithoutAuthorization: string[] = [];

  for (const file of controllerFiles(SRC_DIR)) {
    const source = readFileSync(file, 'utf8');
    const key = relativePath(file);

    const publics = (source.match(PUBLIC_DECORATOR) ?? []).length;
    if (publics > 0) publicRoutes[key] = publics;

    const hasRoutes = (source.match(ROUTE_DECORATOR) ?? []).length > 0;
    const declaresAuthorization = AUTHORIZATION_MARKERS.some((marker) => marker.test(source));
    if (hasRoutes && !declaresAuthorization) controllersWithoutAuthorization.push(key);
  }

  return { publicRoutes, controllersWithoutAuthorization: controllersWithoutAuthorization.sort() };
}

function readBaseline(): Baseline {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Partial<Baseline>;
    return {
      publicRoutes: parsed.publicRoutes ?? {},
      controllersWithoutAuthorization: parsed.controllersWithoutAuthorization ?? [],
    };
  } catch {
    return { publicRoutes: {}, controllersWithoutAuthorization: [] };
  }
}

function main(): void {
  const current = scan();

  if (process.argv.includes('--update-baseline')) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    const totalPublic = Object.values(current.publicRoutes).reduce((sum, count) => sum + count, 0);
    console.log(
      `✅ Baseline de autorización actualizado: ${totalPublic} ruta(s) pública(s) en ` +
        `${Object.keys(current.publicRoutes).length} archivo(s), ` +
        `${current.controllersWithoutAuthorization.length} controlador(es) sin regla de rol.`,
    );
    return;
  }

  const baseline = readBaseline();
  const errors: string[] = [];
  const improvements: string[] = [];

  // 1) Superficie pública: ni archivos nuevos, ni más rutas públicas en los ya conocidos.
  for (const [file, count] of Object.entries(current.publicRoutes)) {
    const allowed = baseline.publicRoutes[file];
    if (allowed === undefined) {
      errors.push(`${file}: ${count} ruta(s) @Public() en un archivo que no tenía ninguna.`);
    } else if (count > allowed) {
      errors.push(`${file}: ${count} rutas @Public() (el baseline acepta ${allowed}).`);
    } else if (count < allowed) {
      improvements.push(`${file}: bajó de ${allowed} a ${count} rutas públicas`);
    }
  }
  for (const file of Object.keys(baseline.publicRoutes)) {
    if (!(file in current.publicRoutes)) improvements.push(`${file}: ya no expone ninguna ruta pública`);
  }

  // 2) Controladores sin regla de autorización: la lista no puede crecer.
  const known = new Set(baseline.controllersWithoutAuthorization);
  for (const file of current.controllersWithoutAuthorization) {
    if (!known.has(file)) {
      errors.push(
        `${file}: tiene rutas pero no declara @Roles(...) ni @InternalPermissions(...), ` +
          'así que cualquier rol autenticado entra.',
      );
    }
  }
  const stillWithout = new Set(current.controllersWithoutAuthorization);
  for (const file of baseline.controllersWithoutAuthorization) {
    if (!stillWithout.has(file)) improvements.push(`${file}: ya declara regla de autorización`);
  }

  if (improvements.length > 0) {
    console.log(`ℹ️  ${improvements.length} mejora(s). Fija el nuevo piso con "yarn check:auth-coverage --update-baseline":`);
    improvements.forEach((improvement) => console.log(`   - ${improvement}`));
  }

  if (errors.length > 0) {
    console.error('❌ La superficie sin sesión o sin rol creció fuera del baseline:');
    errors.forEach((error) => console.error(`   - ${error}`));
    console.error('');
    console.error('   Si la apertura es deliberada, documéntala en el propio controlador y corre');
    console.error('   "yarn check:auth-coverage --update-baseline" en el mismo commit.');
    process.exit(1);
  }

  const totalPublic = Object.values(current.publicRoutes).reduce((sum, count) => sum + count, 0);
  console.log(
    `✅ Cobertura de autorización estable: ${totalPublic} ruta(s) pública(s) declarada(s) y ` +
      `${current.controllersWithoutAuthorization.length} controlador(es) sin regla de rol, todos en el baseline.`,
  );
}

main();
