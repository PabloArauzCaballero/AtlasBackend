/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Un hecho de negocio que nadie consume no puede desaparecer sin dejar rastro.
 * @system cuenta, por código, los eventos de dominio sin registrar que `process_outbox` marca procesados, y los publica como aviso y métrica.
 */

/** Fila que devuelve la reclamación de `process_outbox`. */
export type ClaimedOutboxRow = { id: string; tenant_id: string | null; event_code: string | null; event_family: string | null };

type AvisoLogger = { warn(message: string): void };
type MetricaNoRegistrados = { recordOutboxUnregisteredEvents(input: { eventCode: string; count: number }): void } | undefined;

/**
 * La telemetría HTTP del interceptor (`post_…_completed`, familia `api_audit`) es la población para la
 * que existe `process_outbox`: no es un hueco y no se avisa. Las filas anteriores a la marca de familia
 * (AT-037) se reconocen por el código: un evento de dominio siempre lleva punto (`familia.hecho`).
 */
function isHttpAudit(row: ClaimedOutboxRow): boolean {
  return row.event_family === 'api_audit' || !(row.event_code ?? '').includes('.');
}

/**
 * Hallazgo B12 (plan de procesos, 2026-09-26): `process_outbox` reclama todo lo que NO está en
 * `EVENT_REGISTRY` y lo marca `processed`. Para la telemetría HTTP es lo correcto; para un evento de
 * dominio que alguien olvidó registrar significa que se da por atendido sin que nadie lo consuma. Así
 * vivió `customer.lifecycle.*` semanas: 23 transiciones, 0 avisos, ningún error.
 *
 * Se sigue marcando procesado —dejarlo `pending` haría crecer el backlog para siempre y lo volvería a
 * reclamar en cada corrida—, pero ya no en silencio: devuelve el recuento por código para el
 * `result_json` de la corrida.
 */
export function tallyUnregisteredDomainEvents(rows: readonly ClaimedOutboxRow[]): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const row of rows) {
    if (isHttpAudit(row)) continue;
    const code = row.event_code as string;
    tally[code] = (tally[code] ?? 0) + 1;
  }
  return tally;
}

/** Un aviso por código (no por fila) y la serie `atlas_outbox_unregistered_events_total`. */
export function reportUnregisteredDomainEvents(
  logger: AvisoLogger,
  metrics: MetricaNoRegistrados,
  tenantId: string,
  tally: Record<string, number>,
): void {
  for (const [eventCode, count] of Object.entries(tally)) {
    logger.warn(
      `OUTBOX_UNREGISTERED_EVENT tenant=${tenantId} code=${eventCode} count=${count}: evento de dominio sin entrada en event-registry.ts; se marca procesado sin consumidor.`,
    );
    metrics?.recordOutboxUnregisteredEvents({ eventCode, count });
  }
}
