/**
 * `yarn prestart:cleanup` — cierre seguro y acotado de lo que este repositorio dejó vivo.
 *
 * Sólo actúa sobre procesos con veredicto `owned` (ver `lib/project-processes.ts`). El escalado es
 * el mismo que aplica un orquestador: SIGTERM → espera → SIGKILL, y el SIGKILL sólo si el proceso
 * sigue vivo Y su pertenencia estaba demostrada. Los descendientes se terminan de hoja a raíz para
 * que el padre no reaparezca reenganchando hijos a medio cerrar.
 *
 * Es idempotente: sobre un entorno ya limpio no hace nada y sale con 0.
 *
 * Lo que este script NO hace, por decisión y no por omisión:
 *   - matar por nombre de runtime (`node`, `tsx`) — mataría trabajo ajeno;
 *   - tocar contenedores, volúmenes o bases de datos — ahí viven datos;
 *   - borrar `node_modules`, lockfiles o cachés del gestor de paquetes;
 *   - terminar procesos `unknown` — se reportan y el arranque se bloquea en `prestart:verify`.
 *
 * Banderas:
 *   --dry-run        enumera lo que haría sin enviar ninguna señal.
 *   --build-artifacts  además elimina `dist/` y `coverage/`, para un arranque en frío documentado.
 */
import { rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { captureHostSnapshot, formatBytes } from './lib/host-resources.js';
import { descendantsOf, discoverProjectProcesses, isAlive, type ProjectProcess } from './lib/project-processes.js';
import { writeEvidence } from './lib/evidence.js';

const PROJECT_ROOT = process.cwd();
const DRY_RUN = process.argv.includes('--dry-run');
const CLEAN_BUILD_ARTIFACTS = process.argv.includes('--build-artifacts');
const GRACE_MS = Number(process.env.PERF_SHUTDOWN_GRACE_MS ?? 8000);
const POLL_MS = 250;

type TerminationOutcome = 'already-dead' | 'sigterm' | 'sigkill' | 'survived' | 'skipped-dry-run' | 'signal-error';

type TerminationRecord = {
  pid: number;
  role: 'main' | 'descendant';
  command: string;
  outcome: TerminationOutcome;
  waitedMs: number;
  error?: string;
};

function signal(pid: number, name: NodeJS.Signals): string | null {
  try {
    process.kill(pid, name);
    return null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ESRCH = ya murió entre la comprobación y la señal. No es un fallo.
    return code === 'ESRCH' ? null : `${code ?? 'error'} al enviar ${name}`;
  }
}

/** Espera a que `pid` desaparezca, hasta `GRACE_MS`. Devuelve el tiempo esperado. */
async function waitForExit(pid: number): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < GRACE_MS) {
    if (!isAlive(pid)) return Date.now() - started;
    await sleep(POLL_MS);
  }
  return Date.now() - started;
}

async function terminate(pid: number, command: string, role: 'main' | 'descendant'): Promise<TerminationRecord> {
  if (!isAlive(pid)) return { pid, role, command, outcome: 'already-dead', waitedMs: 0 };
  if (DRY_RUN) return { pid, role, command, outcome: 'skipped-dry-run', waitedMs: 0 };

  const termError = signal(pid, 'SIGTERM');
  if (termError) return { pid, role, command, outcome: 'signal-error', waitedMs: 0, error: termError };

  const waitedMs = await waitForExit(pid);
  if (!isAlive(pid)) return { pid, role, command, outcome: 'sigterm', waitedMs };

  // Sigue vivo tras la ventana de cortesía. El SIGKILL es legítimo aquí y sólo aquí: la pertenencia
  // ya está demostrada por el llamador y el proceso tuvo su oportunidad de cerrar ordenadamente.
  const killError = signal(pid, 'SIGKILL');
  if (killError) return { pid, role, command, outcome: 'signal-error', waitedMs, error: killError };
  await sleep(POLL_MS);
  return { pid, role, command, outcome: isAlive(pid) ? 'survived' : 'sigkill', waitedMs };
}

/** Termina el árbol completo: descendientes primero (de hoja a raíz), luego el proceso principal. */
async function terminateTree(target: ProjectProcess): Promise<TerminationRecord[]> {
  const records: TerminationRecord[] = [];
  for (const child of descendantsOf(target.pid)) {
    records.push(await terminate(child, `(hijo de ${target.pid})`, 'descendant'));
  }
  records.push(await terminate(target.pid, target.command, 'main'));
  return records;
}

/** Directorios de SALIDA regenerables. Nada con datos, dependencias ni configuración entra en esta lista. */
const REGENERABLE_DIRS = ['dist', 'coverage'];

function cleanBuildArtifacts(): string[] {
  const removed: string[] = [];
  for (const name of REGENERABLE_DIRS) {
    const path = resolve(PROJECT_ROOT, name);
    if (!existsSync(path)) continue;
    if (DRY_RUN) {
      removed.push(`${name}/ (dry-run, no eliminado)`);
      continue;
    }
    rmSync(path, { recursive: true, force: true });
    removed.push(`${name}/`);
  }
  return removed;
}

async function main(): Promise<void> {
  const before = captureHostSnapshot(PROJECT_ROOT);
  const discovered = discoverProjectProcesses(PROJECT_ROOT);
  const owned = discovered.filter((item) => item.verdict === 'owned');
  // Se reporta todo lo que no es nuestro pero estorba: tanto lo no identificable como lo que
  // demostradamente pertenece a otro repositorio pero está sentado en un puerto que necesitamos.
  // Ninguno de los dos se toca; `prestart:verify` es quien convierte esto en un bloqueo.
  const undetermined = discovered.filter((item) => item.verdict === 'unknown' || (item.verdict === 'foreign' && item.listeningPorts.length > 0));

  console.log('── Higiene previa · limpieza ─────────────────────────────────────');
  if (DRY_RUN) console.log('MODO SIMULACIÓN: no se enviará ninguna señal ni se borrará nada.');
  console.log(`Memoria disponible antes: ${formatBytes(before.memory.availableBytes.value)}`);
  console.log(`Procesos del proyecto a cerrar: ${owned.length}`);

  const records: TerminationRecord[] = [];
  for (const target of owned) {
    console.log(`  → pid=${target.pid} ${target.command.slice(0, 120)}`);
    records.push(...(await terminateTree(target)));
  }

  const artifactsRemoved = CLEAN_BUILD_ARTIFACTS ? cleanBuildArtifacts() : [];
  if (artifactsRemoved.length > 0) console.log(`Artefactos regenerables eliminados: ${artifactsRemoved.join(', ')}`);

  // Segundo barrido: confirma sobre el estado real del sistema, no sobre lo que creemos haber hecho.
  const remaining = discoverProjectProcesses(PROJECT_ROOT);
  const stillOwned = remaining.filter((item) => item.verdict === 'owned');
  const after = captureHostSnapshot(PROJECT_ROOT);

  console.log('');
  for (const record of records) {
    console.log(`  pid=${record.pid} [${record.role}] → ${record.outcome}${record.error ? ` (${record.error})` : ''} tras ${record.waitedMs} ms`);
  }
  console.log('');
  console.log(`Memoria disponible después: ${formatBytes(after.memory.availableBytes.value)}`);
  console.log(`Procesos del proyecto que siguen vivos: ${stillOwned.length}`);

  if (undetermined.length > 0) {
    console.log('');
    console.log(`⚠️  ${undetermined.length} proceso(s) ajenos o sin pertenencia demostrable — NO se tocaron:`);
    for (const item of undetermined) {
      console.log(`    [${item.verdict}] pid=${item.pid} puertos=${item.listeningPorts.join(',') || 'ninguno'} ${item.command.slice(0, 120)}`);
    }
  }

  const path = writeEvidence(PROJECT_ROOT, 'cleanup', {
    phase: 'cleanup',
    dryRun: DRY_RUN,
    cleanedBuildArtifacts: artifactsRemoved,
    graceMs: GRACE_MS,
    hostBefore: before,
    hostAfter: after,
    targeted: owned,
    untouchedUndetermined: undetermined,
    terminations: records,
    stillAlive: stillOwned,
  });
  console.log(`Evidencia: ${path}`);

  if (stillOwned.length > 0 && !DRY_RUN) {
    console.error('');
    console.error('❌ Quedaron procesos del proyecto vivos tras SIGTERM y SIGKILL. No se puede garantizar un arranque limpio.');
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error('[prestart:cleanup] falló:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
