/**
 * Lectura del estado de recursos del HOST antes y después de limpiar/arrancar.
 *
 * Toda métrica lleva la fuente de la que salió (`source`). Esto no es decorativo: `os.freemem()` en
 * macOS informa sólo páginas completamente libres e ignora las inactivas reclamables, así que
 * reporta "sin memoria" en una máquina que tiene de sobra. Si el número que se guarda en la
 * evidencia no dice de dónde vino, nadie puede juzgar si el arranque se bloqueó por una razón real.
 *
 * Cuando una fuente no está disponible (otra plataforma, comando ausente), el campo vale `null` y
 * `source` lo declara. Nunca se rellena con una estimación.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';

/** Valor medido junto con la fuente exacta de la que se leyó. `null` = no medible en esta plataforma. */
export type Measured<T> = { value: T | null; source: string };

export type MemorySnapshot = {
  totalBytes: number;
  /** Memoria realmente reclamable sin swapear. En macOS incluye inactivas/purgables. */
  availableBytes: Measured<number>;
  swapUsedBytes: Measured<number>;
};

export type CpuSnapshot = {
  cores: number;
  /** Carga a 1, 5 y 15 minutos. En Windows `os.loadavg()` devuelve ceros: se marca no medible. */
  loadAverage: Measured<[number, number, number]>;
};

export type DiskSnapshot = {
  path: string;
  availableBytes: Measured<number>;
  usedPercent: Measured<number>;
};

export type HostSnapshot = {
  capturedAt: string;
  platform: NodeJS.Platform;
  memory: MemorySnapshot;
  cpu: CpuSnapshot;
  disk: DiskSnapshot;
  openFileLimit: Measured<number>;
};

function run(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000 });
  } catch {
    return null;
  }
}

/** Páginas de `vm_stat` (macOS) que cuentan como reclamables sin tocar swap. */
const DARWIN_RECLAIMABLE = ['Pages free', 'Pages inactive', 'Pages speculative', 'Pages purgeable'];

function darwinAvailableBytes(): Measured<number> {
  const output = run('vm_stat', []);
  if (!output) return { value: null, source: 'vm_stat (no disponible)' };

  const pageSize = Number(/page size of (\d+) bytes/.exec(output)?.[1] ?? 4096);
  let pages = 0;
  for (const label of DARWIN_RECLAIMABLE) {
    const match = new RegExp(`${label}:\\s+(\\d+)`).exec(output);
    if (match) pages += Number(match[1]);
  }
  if (pages === 0) return { value: null, source: 'vm_stat (sin páginas reconocibles)' };
  return { value: pages * pageSize, source: 'vm_stat: free+inactive+speculative+purgeable' };
}

function linuxMemAvailableBytes(): Measured<number> {
  const meminfo = readMeminfo();
  if (!meminfo) return { value: null, source: '/proc/meminfo (no disponible)' };
  const match = /MemAvailable:\s+(\d+) kB/.exec(meminfo);
  if (!match) return { value: null, source: '/proc/meminfo (sin MemAvailable)' };
  return { value: Number(match[1]) * 1024, source: '/proc/meminfo MemAvailable' };
}

function readMeminfo(): string | null {
  try {
    return readFileSync('/proc/meminfo', 'utf8');
  } catch {
    // Ausente fuera de Linux. El llamador reporta la métrica como no medible, no como cero.
    return null;
  }
}

function availableMemory(platform: NodeJS.Platform): Measured<number> {
  if (platform === 'darwin') return darwinAvailableBytes();
  if (platform === 'linux') return linuxMemAvailableBytes();
  return { value: os.freemem(), source: 'os.freemem() (sólo páginas libres; subestima lo reclamable)' };
}

function swapUsed(platform: NodeJS.Platform): Measured<number> {
  if (platform === 'darwin') {
    const output = run('sysctl', ['-n', 'vm.swapusage']);
    const match = output && /used = ([\d.]+)([MGK])/.exec(output);
    if (!match) return { value: null, source: 'sysctl vm.swapusage (no disponible)' };
    const scale = match[2] === 'G' ? 1024 ** 3 : match[2] === 'M' ? 1024 ** 2 : 1024;
    return { value: Math.round(Number(match[1]) * scale), source: 'sysctl vm.swapusage' };
  }
  if (platform === 'linux') {
    const meminfo = readMeminfo();
    const total = meminfo && /SwapTotal:\s+(\d+) kB/.exec(meminfo);
    const free = meminfo && /SwapFree:\s+(\d+) kB/.exec(meminfo);
    if (!total || !free) return { value: null, source: '/proc/meminfo (sin datos de swap)' };
    return { value: (Number(total[1]) - Number(free[1])) * 1024, source: '/proc/meminfo SwapTotal-SwapFree' };
  }
  return { value: null, source: `swap no medible en ${platform}` };
}

function diskFor(path: string): DiskSnapshot {
  // `-P` fuerza el formato POSIX de 6 columnas. Sin él, macOS intercala `iused`/`ifree` y contar
  // columnas desde el final devuelve inodos libres como si fueran bytes disponibles.
  const output = run('df', ['-k', '-P', path]);
  if (!output) {
    return {
      path,
      availableBytes: { value: null, source: 'df (no disponible)' },
      usedPercent: { value: null, source: 'df (no disponible)' },
    };
  }
  // Se ancla en la forma numérica (bloques, usados, disponibles, capacidad%) en vez de en índices de
  // columna: un punto de montaje con espacios rompe cualquier conteo posicional.
  const line = output.trim().split('\n').at(-1) ?? '';
  const match = /\s(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%/.exec(line);
  if (!match) {
    return {
      path,
      availableBytes: { value: null, source: 'df -k -P (formato inesperado)' },
      usedPercent: { value: null, source: 'df -k -P (formato inesperado)' },
    };
  }
  return {
    path,
    availableBytes: { value: Number(match[3]) * 1024, source: 'df -k -P' },
    usedPercent: { value: Number(match[4]), source: 'df -k -P' },
  };
}

function openFileLimit(): Measured<number> {
  const output = run('/bin/sh', ['-c', 'ulimit -n']);
  const parsed = Number((output ?? '').trim());
  if (!Number.isFinite(parsed)) return { value: null, source: 'ulimit -n (no disponible)' };
  return { value: parsed, source: 'ulimit -n' };
}

function loadAverage(platform: NodeJS.Platform): Measured<[number, number, number]> {
  const [one, five, fifteen] = os.loadavg();
  // Windows no implementa loadavg: devuelve [0,0,0], que no es "el sistema está ocioso".
  if (platform === 'win32') return { value: null, source: 'os.loadavg() no implementado en win32' };
  return { value: [one, five, fifteen], source: 'os.loadavg()' };
}

/** Fotografía completa del host. Se llama antes de limpiar, después de limpiar y después de arrancar. */
export function captureHostSnapshot(projectRoot: string): HostSnapshot {
  const platform = os.platform();
  return {
    capturedAt: new Date().toISOString(),
    platform,
    memory: {
      totalBytes: os.totalmem(),
      availableBytes: availableMemory(platform),
      swapUsedBytes: swapUsed(platform),
    },
    cpu: { cores: os.cpus().length, loadAverage: loadAverage(platform) },
    disk: diskFor(projectRoot),
    openFileLimit: openFileLimit(),
  };
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'n/d';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} GiB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MiB`;
}
