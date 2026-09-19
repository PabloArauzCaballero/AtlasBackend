/**
 * Descubrimiento de procesos que pertenecen a ESTE repositorio, con prueba de pertenencia.
 *
 * La regla que gobierna todo el archivo: **un proceso sólo es "del proyecto" si dos señales
 * independientes lo confirman** — su línea de comandos invoca un entrypoint conocido de Atlas Y su
 * directorio de trabajo (o un argumento absoluto) cae dentro de la raíz del repositorio.
 *
 * Exigir las dos no es celo excesivo, evita dos accidentes concretos:
 *
 * - Sólo por cwd: la propia shell del usuario, el editor y cualquier `tsc` de otra tarea corren con
 *   cwd en la raíz del repo. Matarlos por "pertenecer al proyecto" cierra la terminal de quien
 *   ejecuta la limpieza.
 * - Sólo por comando: `node dist/src/main.js` es una cadena que existe en decenas de proyectos
 *   Node. Coincidir por ella mata el backend de otro repo abierto en paralelo.
 *
 * Cuando la pertenencia no puede demostrarse (lsof sin permisos, proceso de otro usuario) el
 * veredicto es `unknown` y el proceso NUNCA se termina: se reporta como bloqueo para que una
 * persona decida. Es deliberado que la herramienta prefiera fallar el arranque antes que matar algo
 * que no sabe identificar.
 */
import { execFileSync } from 'node:child_process';
import { resolve, sep } from 'node:path';

export type OwnershipVerdict = 'owned' | 'foreign' | 'unknown';

export type ProjectProcess = {
  pid: number;
  ppid: number | null;
  command: string;
  /** Directorio de trabajo real leído del sistema operativo, no inferido del comando. */
  cwd: string | null;
  /** Puertos del proyecto en los que este PID está escuchando. */
  listeningPorts: number[];
  elapsed: string | null;
  cpuPercent: number | null;
  rssBytes: number | null;
  verdict: OwnershipVerdict;
  /** Señales concretas que sostienen el veredicto. Se vuelca tal cual en la evidencia. */
  evidence: string[];
  /** Cómo apareció: escuchando un puerto del proyecto, por barrido de comandos, o ambos. */
  discoveredBy: ('port' | 'command-sweep')[];
};

/**
 * Entrypoints reconocidos de Atlas. Cada patrón se compara contra la línea de comandos completa.
 * Añadir uno aquí amplía lo que la limpieza puede terminar: hazlo sólo con rutas que este
 * repositorio ejecuta.
 */
const ATLAS_ENTRYPOINTS: RegExp[] = [
  /dist[/\\]src[/\\]main\.js/,
  /dist[/\\]src[/\\]worker\.js/,
  /scripts[/\\]dev-build-and-start\.mjs/,
  /scripts[/\\]run-dev\.mjs/,
  /tsx[^\s]*\s+(watch\s+)?src[/\\](main|worker)\.ts/,
  /src[/\\](main|worker)\.ts/,
  /jest\.config\.cjs/,
  /tsc\s+(-w|--watch)/,
  /scripts[/\\](smoke|stress|perf)[/\\]/,
  /src[/\\]database[/\\](migrate|seed)\.ts/,
];

function run(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 });
  } catch {
    // `lsof`/`ps` salen con código ≠ 0 también cuando simplemente no hay coincidencias. Un fallo y
    // "cero resultados" son indistinguibles aquí, así que el llamador trata `null` como "no sé".
    return null;
  }
}

/** Tabla `pid → {ppid, command}` de todo el sistema, leída una sola vez por invocación. */
function processTable(): Map<number, { ppid: number; command: string }> {
  const table = new Map<number, { ppid: number; command: string }>();
  const output = run('ps', ['-axo', 'pid=,ppid=,command=']);
  if (!output) return table;

  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    table.set(Number(match[1]), { ppid: Number(match[2]), command: match[3].trim() });
  }
  return table;
}

/** Cadena de ancestros del proceso actual: la limpieza jamás debe apuntarse a sí misma ni a su shell. */
function selfLineage(table: Map<number, { ppid: number; command: string }>): Set<number> {
  const lineage = new Set<number>([process.pid]);
  let current = table.get(process.pid)?.ppid ?? null;
  let guard = 0;
  while (current !== null && current > 0 && guard < 64) {
    lineage.add(current);
    current = table.get(current)?.ppid ?? null;
    guard += 1;
  }
  return lineage;
}

/** Directorio de trabajo real del PID. `null` cuando el SO no lo revela (otro usuario, sin permisos). */
export function processCwd(pid: number): string | null {
  const output = run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  if (!output) return null;
  for (const line of output.split('\n')) {
    if (line.startsWith('n')) return line.slice(1).trim();
  }
  return null;
}

/** PIDs escuchando en `port`. Sólo sockets en LISTEN: un cliente conectado al puerto no cuenta. */
export function listenersOnPort(port: number): number[] {
  const output = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']);
  if (!output) return [];
  const pids = new Set<number>();
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pids.add(Number(line.slice(1)));
  }
  return [...pids].filter((pid) => Number.isFinite(pid) && pid > 0);
}

function isUnder(child: string | null, parent: string): boolean {
  if (!child) return false;
  const normalized = resolve(child);
  return normalized === parent || normalized.startsWith(parent + sep);
}

function matchesAtlasEntrypoint(command: string): RegExp | null {
  return ATLAS_ENTRYPOINTS.find((pattern) => pattern.test(command)) ?? null;
}

type Vitals = { elapsed: string | null; cpuPercent: number | null; rssBytes: number | null };

function vitals(pid: number): Vitals {
  const output = run('ps', ['-o', 'etime=,pcpu=,rss=', '-p', String(pid)]);
  const parts = (output ?? '').trim().split(/\s+/);
  if (parts.length < 3) return { elapsed: null, cpuPercent: null, rssBytes: null };
  return {
    elapsed: parts[0],
    cpuPercent: Number.isFinite(Number(parts[1])) ? Number(parts[1]) : null,
    rssBytes: Number.isFinite(Number(parts[2])) ? Number(parts[2]) * 1024 : null,
  };
}

/**
 * Decide la pertenencia con las dos señales independientes y deja escrito por qué.
 *
 * `foreign` exige prueba positiva de estar fuera (un cwd legible que no cae bajo la raíz). La
 * ausencia de prueba es `unknown`, no `foreign`: son estados distintos y sólo uno de los tres
 * habilita terminar el proceso.
 */
function judge(input: { command: string; cwd: string | null; projectRoot: string }): { verdict: OwnershipVerdict; evidence: string[] } {
  const evidence: string[] = [];
  const entrypoint = matchesAtlasEntrypoint(input.command);
  if (entrypoint) evidence.push(`comando coincide con entrypoint Atlas ${String(entrypoint)}`);

  const cwdInside = isUnder(input.cwd, input.projectRoot);
  if (cwdInside) evidence.push(`cwd dentro de la raíz del proyecto (${input.cwd})`);

  const argInside = input.command.includes(input.projectRoot);
  if (argInside) evidence.push('la línea de comandos contiene la ruta absoluta del proyecto');

  if (entrypoint && (cwdInside || argInside)) return { verdict: 'owned', evidence };

  if (input.cwd && !cwdInside && !argInside) {
    evidence.push(`cwd fuera del proyecto (${input.cwd}): no es de este repositorio`);
    return { verdict: 'foreign', evidence };
  }

  evidence.push(
    entrypoint
      ? 'coincide el entrypoint pero no se pudo confirmar el cwd: pertenencia no demostrable'
      : 'no coincide con ningún entrypoint conocido de Atlas',
  );
  return { verdict: 'unknown', evidence };
}

/** Puertos que este repositorio arranca. La infraestructura (Postgres, Redis) queda deliberadamente fuera. */
export function projectPorts(): number[] {
  const appPort = Number(process.env.APP_PORT ?? 3005);
  const workerProbePort = Number(process.env.WORKER_PROBE_PORT ?? 3006);
  return [...new Set([appPort, workerProbePort])].filter((port) => Number.isFinite(port) && port > 0);
}

/**
 * Barrido en dos modalidades: por puerto y por comando. Son independientes a propósito — un worker
 * huérfano no escucha ningún puerto y sólo aparece en el barrido de comandos; un servidor arrancado
 * desde otra ruta sí ocupa el puerto y sólo aparece en el sondeo de puertos.
 */
export function discoverProjectProcesses(projectRoot: string): ProjectProcess[] {
  const root = resolve(projectRoot);
  const table = processTable();
  const excluded = selfLineage(table);
  const ports = projectPorts();

  const portOwners = new Map<number, number[]>();
  for (const port of ports) {
    for (const pid of listenersOnPort(port)) {
      portOwners.set(pid, [...(portOwners.get(pid) ?? []), port]);
    }
  }

  const candidates = new Map<number, ('port' | 'command-sweep')[]>();
  for (const pid of portOwners.keys()) candidates.set(pid, ['port']);
  for (const [pid, info] of table) {
    if (!matchesAtlasEntrypoint(info.command)) continue;
    candidates.set(pid, [...(candidates.get(pid) ?? []), 'command-sweep']);
  }

  const found: ProjectProcess[] = [];
  for (const [pid, discoveredBy] of candidates) {
    if (excluded.has(pid)) continue;
    const info = table.get(pid);
    const command = info?.command ?? '(comando no legible)';
    const cwd = processCwd(pid);
    const { verdict, evidence } = judge({ command, cwd, projectRoot: root });
    found.push({
      pid,
      ppid: info?.ppid ?? null,
      command,
      cwd,
      listeningPorts: portOwners.get(pid) ?? [],
      ...vitals(pid),
      verdict,
      evidence,
      discoveredBy,
    });
  }

  return found.sort((a, b) => a.pid - b.pid);
}

/** Descendientes de `pid`, hijos primero, para poder terminar el árbol de hojas hacia la raíz. */
export function descendantsOf(pid: number): number[] {
  const table = processTable();
  const children = new Map<number, number[]>();
  for (const [child, info] of table) {
    children.set(info.ppid, [...(children.get(info.ppid) ?? []), child]);
  }

  const ordered: number[] = [];
  const walk = (current: number, depth: number): void => {
    if (depth > 16) return;
    for (const child of children.get(current) ?? []) {
      walk(child, depth + 1);
      ordered.push(child);
    }
  };
  walk(pid, 0);
  return ordered;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = existe pero es de otro usuario. Sigue vivo, y además fuera de nuestro alcance.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
