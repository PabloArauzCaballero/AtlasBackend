/**
 * Gate estático: ningún script puede arrancar un punto de entrada de NestJS con un transpilador
 * que borre la metadata de decoradores.
 *
 * `tsx` y `esbuild-register` no emiten `design:paramtypes`. Nest lo necesita para resolver
 * dependencias por tipo, así que un arranque así muere con "Nest can't resolve dependencies of
 * XService (Repo, ?, +, +)", que culpa a un módulo perfectamente cableado. Es un rastro falso caro:
 * se busca un ciclo de imports que no existe. El repositorio llegó a publicar un `start:dev:tsx`
 * que no podía funcionar nunca.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();
/** Transpiladores que borran la metadata de decoradores. */
const METADATA_ERASING_RUNNERS = ['tsx', 'esbuild-register', 'esno'];

function collectNestEntrypoints(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectNestEntrypoints(full, found);
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    // Se busca la LLAMADA, no la palabra: este mismo gate nombra la clase en su documentación, y
    // un chequeo por substring se marcaría a sí mismo.
    if (/NestFactory\s*\.\s*create/.test(readFileSync(full, 'utf8'))) {
      found.push(full.slice(ROOT.length + 1));
    }
  }
  return found;
}

function main(): void {
  const entrypoints = collectNestEntrypoints(resolve(ROOT, 'src')).concat(collectNestEntrypoints(resolve(ROOT, 'scripts')));
  // `ATLAS_GATE_FIXTURE` es la costura de prueba: permite comprobar que el gate RECHAZA lo que
  // debe rechazar sin tener que romper el package.json real para averiguarlo.
  const manifest = process.env.ATLAS_GATE_FIXTURE ?? readFileSync(resolve(ROOT, 'package.json'), 'utf8');
  const scripts = (JSON.parse(manifest).scripts ?? {}) as Record<string, string>;

  const errors: string[] = [];
  for (const [name, command] of Object.entries(scripts)) {
    const runner = METADATA_ERASING_RUNNERS.find((candidate) => new RegExp(`(^|[\\s&|])${candidate}(\\s|$)`).test(command));
    if (!runner) continue;

    const entrypoint = entrypoints.find((file) => command.includes(file));
    if (entrypoint) {
      errors.push(
        `"${name}": arranca ${entrypoint} (crea un contexto Nest) con \`${runner}\`, que borra la metadata de ` +
          'decoradores. Compila primero y ejecuta el JavaScript resultante.',
      );
    }
  }

  if (errors.length > 0) {
    console.error('❌ Puntos de entrada de Nest ejecutados con un transpilador sin metadata:');
    for (const error of errors) console.error(`   - ${error}`);
    process.exit(1);
  }

  console.log(`✅ ${entrypoints.length} punto(s) de entrada de Nest: ninguno se arranca con un transpilador que borre la metadata.`);
}

main();
