/**
 * `yarn prestart:diagnose` — inventario del entorno ANTES de tocar nada.
 *
 * No termina procesos ni borra archivos: sólo observa y deja la evidencia. Es la foto "antes de
 * limpiar" que el procedimiento exige y contra la que se compara todo lo demás.
 *
 * Sale con 0 aunque encuentre procesos vivos: encontrar cosas es su trabajo, no un fallo. Quien
 * decide si el entorno sirve para arrancar es `prestart:verify`.
 */
import { discoverProjectProcesses, projectPorts, type ProjectProcess } from './lib/project-processes.js';
import { captureHostSnapshot, formatBytes } from './lib/host-resources.js';
import { evaluateCapacity } from './lib/capacity.js';
import { writeEvidence } from './lib/evidence.js';

const PROJECT_ROOT = process.cwd();

function describe(process_: ProjectProcess): string {
  const ports = process_.listeningPorts.length > 0 ? ` puertos=${process_.listeningPorts.join(',')}` : '';
  const rss = process_.rssBytes === null ? '' : ` rss=${formatBytes(process_.rssBytes)}`;
  const cpu = process_.cpuPercent === null ? '' : ` cpu=${process_.cpuPercent}%`;
  return `  [${process_.verdict}] pid=${process_.pid}${ports} etime=${process_.elapsed ?? 'n/d'}${cpu}${rss}\n      cmd: ${process_.command.slice(0, 160)}\n      ${process_.evidence.join('; ')}`;
}

function main(): void {
  const snapshot = captureHostSnapshot(PROJECT_ROOT);
  const processes = discoverProjectProcesses(PROJECT_ROOT);
  const capacity = evaluateCapacity(snapshot);
  const ports = projectPorts();

  const owned = processes.filter((item) => item.verdict === 'owned');
  const undetermined = processes.filter((item) => item.verdict === 'unknown');
  const foreign = processes.filter((item) => item.verdict === 'foreign');
  const occupiedPorts = [...new Set(processes.flatMap((item) => item.listeningPorts))];

  console.log('── Higiene previa · diagnóstico ──────────────────────────────────');
  console.log(`Raíz del proyecto : ${PROJECT_ROOT}`);
  console.log(`Plataforma        : ${snapshot.platform}`);
  console.log(`Puertos vigilados : ${ports.join(', ')} (infraestructura como Postgres/Redis queda fuera de alcance)`);
  console.log('');
  console.log('Recursos del host:');
  console.log(`  memoria total     : ${formatBytes(snapshot.memory.totalBytes)}`);
  console.log(`  memoria disponible: ${formatBytes(snapshot.memory.availableBytes.value)}  [${snapshot.memory.availableBytes.source}]`);
  console.log(`  swap en uso       : ${formatBytes(snapshot.memory.swapUsedBytes.value)}  [${snapshot.memory.swapUsedBytes.source}]`);
  console.log(
    `  CPU               : ${snapshot.cpu.cores} núcleos, load1=${snapshot.cpu.loadAverage.value?.[0].toFixed(2) ?? 'n/d'}  [${snapshot.cpu.loadAverage.source}]`,
  );
  console.log(`  disco libre       : ${formatBytes(snapshot.disk.availableBytes.value)} (uso ${snapshot.disk.usedPercent.value ?? 'n/d'}%)`);
  console.log(`  límite de fds     : ${snapshot.openFileLimit.value ?? 'n/d'}  [${snapshot.openFileLimit.source}]`);
  console.log('');

  console.log(`Procesos candidatos: ${processes.length} (del proyecto: ${owned.length}, ajenos: ${foreign.length}, sin determinar: ${undetermined.length})`);
  if (processes.length === 0) console.log('  ninguno: no hay instancias previas de Atlas en esta máquina.');
  for (const item of processes) console.log(describe(item));
  console.log('');

  if (occupiedPorts.length > 0) console.log(`Puertos del proyecto ocupados: ${occupiedPorts.join(', ')}`);
  else console.log('Puertos del proyecto: libres.');
  console.log('');

  console.log('Capacidad para arrancar y medir:');
  for (const check of capacity) {
    const mark = check.ok ? 'ok  ' : check.blocking ? 'FALLA' : 'aviso';
    console.log(`  [${mark}] ${check.name}: ${check.detail}`);
  }

  if (undetermined.length > 0) {
    console.log('');
    console.log('⚠️  Hay procesos cuya pertenencia no pudo demostrarse. `prestart:cleanup` NO los tocará.');
    console.log('    Revísalos a mano; si son tuyos, ciérralos tú y vuelve a ejecutar el diagnóstico.');
  }

  const path = writeEvidence(PROJECT_ROOT, 'diagnose', {
    phase: 'diagnose',
    projectRoot: PROJECT_ROOT,
    watchedPorts: ports,
    host: snapshot,
    processes,
    capacity,
    summary: { total: processes.length, owned: owned.length, foreign: foreign.length, undetermined: undetermined.length, occupiedPorts },
  });
  console.log('');
  console.log(`Evidencia: ${path}`);
}

main();
