/**
 * ¿Tiene esta máquina margen para arrancar y medir?
 *
 * Los umbrales no son un objetivo de rendimiento del producto: son el mínimo para que una medición
 * signifique algo. Un baseline tomado con la máquina swapeando o con el disco lleno mide la
 * saturación del host, no el backend, y es peor que no tener baseline porque parece un dato.
 *
 * Todos son ajustables por variable de entorno; los valores por defecto están dimensionados para el
 * arranque real de este repositorio (API Nest + tsc + suite Jest), no elegidos al azar.
 */
import type { HostSnapshot } from './host-resources.js';
import { formatBytes } from './host-resources.js';

export type CapacityCheck = { name: string; ok: boolean; detail: string; blocking: boolean };

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function capacityThresholds(): { minAvailableMemoryBytes: number; maxSwapUsedBytes: number; minDiskBytes: number; maxLoadPerCore: number } {
  return {
    // ~1.5 GiB: `tsc -p tsconfig.json` sobre este proyecto más el proceso Nest arrancado.
    minAvailableMemoryBytes: numberEnv('PERF_MIN_AVAILABLE_MEMORY_MB', 1536) * 1024 ** 2,
    // Algo de swap en macOS es normal aunque sobre memoria; 2 GiB en uso ya indica presión real.
    maxSwapUsedBytes: numberEnv('PERF_MAX_SWAP_USED_MB', 2048) * 1024 ** 2,
    minDiskBytes: numberEnv('PERF_MIN_DISK_FREE_MB', 2048) * 1024 ** 2,
    // Carga por núcleo por encima de 1 significa que hay más trabajo listo que CPUs para ejecutarlo.
    maxLoadPerCore: numberEnv('PERF_MAX_LOAD_PER_CORE', 1.5),
  };
}

/**
 * Evalúa la fotografía del host contra los umbrales.
 *
 * Una métrica no medible (`value: null`) produce un check NO bloqueante: la plataforma no permite
 * leerla, y bloquear el arranque por eso convertiría la herramienta en inservible en Windows. Se
 * reporta como advertencia visible para que la limitación quede en la evidencia.
 */
export function evaluateCapacity(snapshot: HostSnapshot): CapacityCheck[] {
  const limits = capacityThresholds();
  const checks: CapacityCheck[] = [];

  const available = snapshot.memory.availableBytes;
  checks.push(
    available.value === null
      ? { name: 'memoria disponible', ok: true, detail: `no medible (${available.source})`, blocking: false }
      : {
          name: 'memoria disponible',
          ok: available.value >= limits.minAvailableMemoryBytes,
          detail: `${formatBytes(available.value)} disponibles, mínimo ${formatBytes(limits.minAvailableMemoryBytes)} (${available.source})`,
          blocking: true,
        },
  );

  const swap = snapshot.memory.swapUsedBytes;
  checks.push(
    swap.value === null
      ? { name: 'presión de swap', ok: true, detail: `no medible (${swap.source})`, blocking: false }
      : {
          name: 'presión de swap',
          ok: swap.value <= limits.maxSwapUsedBytes,
          detail: `${formatBytes(swap.value)} en uso, máximo ${formatBytes(limits.maxSwapUsedBytes)} (${swap.source})`,
          blocking: true,
        },
  );

  const disk = snapshot.disk.availableBytes;
  checks.push(
    disk.value === null
      ? { name: 'disco disponible', ok: true, detail: `no medible (${disk.source})`, blocking: false }
      : {
          name: 'disco disponible',
          ok: disk.value >= limits.minDiskBytes,
          detail: `${formatBytes(disk.value)} libres en ${snapshot.disk.path}, mínimo ${formatBytes(limits.minDiskBytes)}`,
          blocking: true,
        },
  );

  const load = snapshot.cpu.loadAverage;
  if (load.value === null) {
    checks.push({ name: 'carga de CPU', ok: true, detail: `no medible (${load.source})`, blocking: false });
  } else {
    const perCore = load.value[0] / Math.max(1, snapshot.cpu.cores);
    checks.push({
      name: 'carga de CPU',
      ok: perCore <= limits.maxLoadPerCore,
      detail: `${perCore.toFixed(2)} por núcleo (load1=${load.value[0].toFixed(2)}, ${snapshot.cpu.cores} núcleos), máximo ${limits.maxLoadPerCore}`,
      // Advertencia: en un portátil la carga fluctúa con procesos ajenos y bloquear por eso
      // impediría trabajar. Queda registrada porque invalida un benchmark, no un arranque.
      blocking: false,
    });
  }

  return checks;
}

export function hasBlockingFailure(checks: CapacityCheck[]): boolean {
  return checks.some((check) => check.blocking && !check.ok);
}
