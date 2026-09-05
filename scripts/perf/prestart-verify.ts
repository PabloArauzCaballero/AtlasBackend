/**
 * `yarn prestart:verify` — la puerta. Decide si este entorno puede arrancar y medir.
 *
 * Es el único script de la fase que falla a propósito: sale con código ≠ 0 cuando no puede
 * GARANTIZAR un arranque limpio. Esa es toda su razón de existir — sin un paso que rompa la
 * cadena, `start:clean` degrada a `start` con pasos decorativos delante.
 *
 * Bloquea por cuatro motivos, cada uno con su exit code para poder distinguirlos en CI:
 *   2 → sobreviven procesos del proyecto;
 *   3 → un puerto del proyecto está ocupado por algo que no pudimos identificar;
 *   4 → el host no tiene margen (memoria, swap o disco);
 *   1 → error inesperado ejecutando la verificación.
 */
import { captureHostSnapshot, formatBytes } from './lib/host-resources.js';
import { discoverProjectProcesses, projectPorts } from './lib/project-processes.js';
import { evaluateCapacity, hasBlockingFailure } from './lib/capacity.js';
import { writeEvidence } from './lib/evidence.js';

const PROJECT_ROOT = process.cwd();

const EXIT = { ok: 0, unexpected: 1, processesAlive: 2, portOccupied: 3, noCapacity: 4 } as const;

function main(): void {
  const host = captureHostSnapshot(PROJECT_ROOT);
  const processes = discoverProjectProcesses(PROJECT_ROOT);
  const capacity = evaluateCapacity(host);
  const ports = projectPorts();

  const stillOwned = processes.filter((item) => item.verdict === 'owned');
  // Un puerto del proyecto tomado por un proceso que no supimos identificar es exactamente el caso
  // que el procedimiento prohíbe resolver a la fuerza: no se mata, se bloquea y lo mira una persona.
  const unidentifiedOnPort = processes.filter((item) => item.verdict !== 'owned' && item.listeningPorts.length > 0);

  const blockers: string[] = [];
  console.log('── Higiene previa · verificación ─────────────────────────────────');
  console.log(`Puertos del proyecto: ${ports.join(', ')}`);

  if (stillOwned.length === 0) {
    console.log('  [ok  ] sin instancias previas de Atlas vivas.');
  } else {
    console.log(`  [FALLA] ${stillOwned.length} proceso(s) del proyecto siguen vivos:`);
    for (const item of stillOwned) console.log(`          pid=${item.pid} ${item.command.slice(0, 130)}`);
    blockers.push('procesos-del-proyecto-vivos');
  }

  if (unidentifiedOnPort.length === 0) {
    console.log('  [ok  ] ningún puerto del proyecto ocupado por procesos ajenos o no identificados.');
  } else {
    console.log(`  [FALLA] ${unidentifiedOnPort.length} proceso(s) no identificados ocupan puertos del proyecto:`);
    for (const item of unidentifiedOnPort) {
      console.log(`          pid=${item.pid} puertos=${item.listeningPorts.join(',')} [${item.verdict}] ${item.command.slice(0, 110)}`);
      console.log(`          ${item.evidence.join('; ')}`);
    }
    console.log('          Ciérralos tú: la limpieza automática no termina lo que no puede demostrar que es nuestro.');
    blockers.push('puerto-ocupado-por-proceso-no-identificado');
  }

  console.log('');
  console.log('Capacidad del host:');
  for (const check of capacity) {
    const mark = check.ok ? 'ok  ' : check.blocking ? 'FALLA' : 'aviso';
    console.log(`  [${mark}] ${check.name}: ${check.detail}`);
  }
  if (hasBlockingFailure(capacity)) blockers.push('host-sin-capacidad');

  const verdict = blockers.length === 0 ? 'clean' : 'blocked';
  const path = writeEvidence(PROJECT_ROOT, 'verify', {
    phase: 'verify',
    verdict,
    blockers,
    watchedPorts: ports,
    host,
    processes,
    capacity,
    memoryAvailableFormatted: formatBytes(host.memory.availableBytes.value),
  });

  console.log('');
  console.log(`Evidencia: ${path}`);

  if (blockers.includes('procesos-del-proyecto-vivos')) exitWith(EXIT.processesAlive, blockers);
  if (blockers.includes('puerto-ocupado-por-proceso-no-identificado')) exitWith(EXIT.portOccupied, blockers);
  if (blockers.includes('host-sin-capacidad')) exitWith(EXIT.noCapacity, blockers);

  console.log('✅ Entorno limpio y con capacidad. Se puede arrancar una única instancia.');
}

function exitWith(code: number, blockers: string[]): never {
  console.error('');
  console.error(`❌ No se puede garantizar un arranque limpio (${blockers.join(', ')}). Exit ${code}.`);
  process.exit(code);
}

try {
  main();
} catch (error: unknown) {
  console.error('[prestart:verify] falló:', error instanceof Error ? error.message : String(error));
  process.exit(EXIT.unexpected);
}
