/**
 * Gate estático: congela la duplicación de `@Headers('x-tenant-id')` en controllers (ATLAS-SEC-002).
 *
 * `@CurrentTenant()` (`src/common/decorators/current-tenant.decorator.ts`) ya encapsula el patrón
 * `@Headers('x-tenant-id') header` + `tenantIdFromHeader(header, user)`. La brecha de seguridad real
 * la cierra `TenantGuard`, así que lo que queda es duplicación, no riesgo — y por eso el registro de
 * pendientes decidió migrar cada controller cuando se toque por otra razón, en vez de hacer un
 * refactor de 26 archivos (y sus 26 specs) sin beneficio funcional en un backend fintech.
 *
 * Ese acuerdo solo se sostiene si la deuda no crece. Este gate es el trinquete: los controllers que
 * hoy usan el patrón manual están en el baseline de abajo, y cualquier archivo NUEVO que lo
 * introduzca —o cualquiera del baseline que sume más usos— falla el build. Cuando un controller se
 * migre a `@CurrentTenant()`, su entrada se baja o se borra con `--update-baseline`.
 *
 * Mismo espíritu que `check-file-size.ts`: la deuda conocida se documenta y se congela; la deuda
 * nueva se bloquea.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const MODULES_DIR = resolve(process.cwd(), 'src/modules');
const BASELINE_PATH = resolve(process.cwd(), '.tenant-header-baseline.json');
const TENANT_HEADER = /@Headers\(\s*'x-tenant-id'\s*\)/g;

function controllerFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) controllerFiles(full, found);
    else if (entry.endsWith('.controller.ts')) found.push(full);
  }
  return found;
}

function currentUsage(): Record<string, number> {
  const usage: Record<string, number> = {};
  for (const file of controllerFiles(MODULES_DIR)) {
    const count = (readFileSync(file, 'utf8').match(TENANT_HEADER) ?? []).length;
    if (count > 0) usage[relative(process.cwd(), file).replace(/\\/g, '/')] = count;
  }
  return usage;
}

function readBaseline(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}

function main(): void {
  const usage = currentUsage();

  if (process.argv.includes('--update-baseline')) {
    const ordered = Object.fromEntries(Object.entries(usage).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(BASELINE_PATH, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
    console.log(`✅ Baseline actualizado: ${Object.keys(ordered).length} controllers con el patrón manual.`);
    return;
  }

  const baseline = readBaseline();
  const errors: string[] = [];
  const improvements: string[] = [];

  for (const [file, count] of Object.entries(usage)) {
    const allowed = baseline[file];
    if (allowed === undefined) {
      errors.push(`${file}: usa @Headers('x-tenant-id') (${count}). Usa @CurrentTenant() — ver ATLAS-SEC-002.`);
    } else if (count > allowed) {
      errors.push(`${file}: pasó de ${allowed} a ${count} usos de @Headers('x-tenant-id'). La deuda congelada no puede crecer.`);
    } else if (count < allowed) {
      improvements.push(`${file}: ${allowed} -> ${count}`);
    }
  }

  for (const file of Object.keys(baseline)) {
    if (!(file in usage)) improvements.push(`${file}: migrado por completo a @CurrentTenant()`);
  }

  if (improvements.length > 0) {
    console.log(
      `ℹ️  ${improvements.length} controller(s) mejoraron. Corre "yarn check:tenant-header --update-baseline" para fijar el nuevo piso:`,
    );
    improvements.forEach((improvement) => console.log(`   - ${improvement}`));
  }

  if (errors.length > 0) {
    console.error('❌ Duplicación de lectura de x-tenant-id fuera del baseline:');
    errors.forEach((error) => console.error(`   - ${error}`));
    process.exit(1);
  }

  const total = Object.values(usage).reduce((sum, count) => sum + count, 0);
  console.log(
    `✅ Sin usos nuevos de @Headers('x-tenant-id'): ${Object.keys(usage).length} controllers / ${total} usos, todos en el baseline.`,
  );
}

main();
