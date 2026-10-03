/**
 * @file Reglas de semáforo del resumen de monitoreo (funciones puras).
 * @business Telegram y el portal admin tienen que decir lo mismo: estas reglas copian las del portal
 *   (`traffic-routes-table`, `providers-dashboard`, `network-blocks-table`, `portfolio-delivery`) en un solo
 *   sitio, para que quien lee el informe no vea «rojo» en un lado y «verde» en el otro.
 * @system Cada regla devuelve `ok | warn | bad | unknown`. `unknown` es «sin datos»: nunca se pinta de verde.
 */
import type { BlockLiveState } from './systems-network-health.service.js';

export type MonitorStatus = 'ok' | 'warn' | 'bad' | 'unknown';

const RANK: Record<MonitorStatus, number> = { unknown: 0, ok: 1, warn: 2, bad: 3 };

/** El peor de varios estados; `unknown` sólo gana si no hay ningún dato. */
export function worstStatus(statuses: readonly MonitorStatus[]): MonitorStatus {
  const known = statuses.filter((status) => status !== 'unknown');
  if (known.length === 0) return 'unknown';
  return known.reduce((worst, status) => (RANK[status] > RANK[worst] ? status : worst), 'ok' as MonitorStatus);
}

/** Bloque del ecosistema: DOWN rojo, DEGRADED ámbar, UP verde, sin configurar = sin datos. */
export function networkStatus(state: BlockLiveState): MonitorStatus {
  if (state === 'DOWN') return 'bad';
  if (state === 'DEGRADED') return 'warn';
  if (state === 'UP') return 'ok';
  return 'unknown';
}

/** Una herramienta CRÍTICA con sonda en vivo y caída es rojo; el resto no cuenta (el portal las ignora). */
export function criticalToolsStatus(tools: ReadonlyArray<{ isCritical: boolean; isHealthy: boolean | null }>): MonitorStatus {
  const critical = tools.filter((tool) => tool.isCritical && tool.isHealthy !== null);
  if (critical.length === 0) return 'unknown';
  return critical.some((tool) => tool.isHealthy === false) ? 'bad' : 'ok';
}

/** Mínimo de peticiones para fiarse de un porcentaje: con 3 peticiones un fallo es 33 %. */
export const MIN_REQUESTS_FOR_RATE = 20;
/** Error de ruta por encima del 2 % rojo (regla del portal); p95 por encima de 2 s ámbar. */
export const TRAFFIC_ERROR_RATE_BAD = 0.02;
export const TRAFFIC_P95_WARN_MS = 2000;

export function trafficStatus(summary: { totalRequests: number; serverErrorRate: number; p95LatencyMs: number }): MonitorStatus {
  if (summary.totalRequests < MIN_REQUESTS_FOR_RATE) return 'unknown';
  if (summary.serverErrorRate > TRAFFIC_ERROR_RATE_BAD) return 'bad';
  if (summary.p95LatencyMs > TRAFFIC_P95_WARN_MS) return 'warn';
  return 'ok';
}

/**
 * Proveedores externos. `successRate` viene en PORCENTAJE (0-100) o null sin llamadas. Éxito ≥95 verde,
 * ≥80 ámbar, menos rojo; que no respondan todos, ámbar. Sin ningún proveedor medido no hay semáforo.
 */
export function providersStatus(totals: {
  providers: number;
  respondingProviders: number;
  unmeasuredProviders: number;
  successRate: number | null;
}): MonitorStatus {
  const measured = totals.providers - totals.unmeasuredProviders;
  if (totals.providers === 0 || (measured === 0 && totals.successRate === null)) return 'unknown';
  const byRate: MonitorStatus =
    totals.successRate === null ? 'unknown' : totals.successRate >= 95 ? 'ok' : totals.successRate >= 80 ? 'warn' : 'bad';
  const byHealth: MonitorStatus = measured > 0 && totals.respondingProviders < measured ? 'warn' : measured > 0 ? 'ok' : 'unknown';
  return worstStatus([byRate, byHealth]);
}

/** Entrega de desenlaces al Motor: agotados rojo, reintentando ámbar. Sin configurar = sin datos. */
export function outcomesStatus(summary: { configured: boolean; exhausted: number; retrying: number }): MonitorStatus {
  if (!summary.configured) return 'unknown';
  if (summary.exhausted > 0) return 'bad';
  if (summary.retrying > 0) return 'warn';
  return 'ok';
}

/** Cola de revisión humana: el caso abierto más antiguo, en horas; pasadas 24 h es ámbar. */
export const REVIEW_QUEUE_WARN_HOURS = 24;
export function reviewQueueStatus(oldestOpenAgeHours: number | null): MonitorStatus {
  if (oldestOpenAgeHours === null) return 'ok';
  return oldestOpenAgeHours > REVIEW_QUEUE_WARN_HOURS ? 'warn' : 'ok';
}

/**
 * Servidor de TEST (la instantánea que manda el informador). Mismos umbrales que sus alertas de Telegram:
 * RAM disponible < 2 GB rojo, disco ≥85 % ámbar y ≥90 % rojo, carga a 15 min > 3 por núcleo ámbar,
 * copia de bases con más de 7 h rojo. Una instantánea con más de 10 min está «vieja» y no se pinta de verde.
 */
export const HOST_RAM_MIN_MB = 2048;
export const HOST_DISK_WARN_PCT = 85;
export const HOST_DISK_BAD_PCT = 90;
export const HOST_LOAD_PER_CORE = 3;
export const HOST_BACKUP_MAX_HOURS = 7;
export const HOST_SNAPSHOT_STALE_MINUTES = 10;

export function hostStatus(host: {
  ramAvailableMb: number;
  diskPct: number;
  load15: number;
  cores: number;
  backupAgeHours: number | null;
  ageMinutes: number;
}) {
  const ram: MonitorStatus = host.ramAvailableMb < HOST_RAM_MIN_MB ? 'bad' : 'ok';
  const disk: MonitorStatus = host.diskPct >= HOST_DISK_BAD_PCT ? 'bad' : host.diskPct >= HOST_DISK_WARN_PCT ? 'warn' : 'ok';
  const load: MonitorStatus = host.load15 > host.cores * HOST_LOAD_PER_CORE ? 'warn' : 'ok';
  const backup: MonitorStatus = host.backupAgeHours === null ? 'unknown' : host.backupAgeHours >= HOST_BACKUP_MAX_HOURS ? 'bad' : 'ok';
  const stale = host.ageMinutes > HOST_SNAPSHOT_STALE_MINUTES;
  // Sin datos frescos no hay verde: el peor de los demás, y como mínimo ámbar.
  const worst = worstStatus([ram, disk, load, backup]);
  const overall: MonitorStatus = stale ? worstStatus([worst === 'ok' || worst === 'unknown' ? 'warn' : worst]) : worst;
  return { ram, disk, load, backup, stale, overall };
}
