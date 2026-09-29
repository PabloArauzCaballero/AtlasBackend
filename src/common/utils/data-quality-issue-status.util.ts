/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza evita que una incidencia de calidad cuente como atendida sin que nadie la haya cerrado con motivo.
 * @system define en un solo sitio qué estados de `data_quality_issues` están cerrados y cuáles siguen pendientes.
 */

/**
 * Estados de una incidencia de calidad (`data_quality_issues.issue_status`):
 *
 * - `open`: nadie la ha revisado (también las filas sin estado).
 * - `acknowledged`: «reconocida». Alguien confirmó con motivo y notas que el problema es real y se
 *   hace cargo, pero el dato sigue mal: la incidencia SIGUE PENDIENTE y se puede cerrar después.
 * - `resolved`: el dato se corrigió. `ignored`: se descartó (no requiere corrección) con motivo.
 *   `closed`: estado heredado de cierre.
 *
 * Hasta el 2026-09-29 cada consulta decidía por su cuenta qué era «abierta»: el semáforo de salida,
 * el conteo por regla y el reporte excluían `acknowledged` —así que «Reconocer», que no pedía motivo,
 * bajaba el contador sin dejar razón— y contaban `ignored` como abierta para siempre, aunque la
 * bandeja la daba por cerrada y no dejaba volver a tocarla. Una sola lista evita que vuelvan a
 * divergir.
 */
export const DATA_QUALITY_CLOSED_STATUSES = ['resolved', 'ignored', 'closed'] as const;

export const DATA_QUALITY_ACKNOWLEDGED_STATUS = 'acknowledged';

/** Estado normalizado: minúsculas y `open` para las filas sin estado. */
export function normalizeIssueStatus(status: string | null | undefined): string {
  const value = (status ?? '').trim().toLowerCase();
  return value.length > 0 ? value : 'open';
}

export function isClosedIssueStatus(status: string | null | undefined): boolean {
  return (DATA_QUALITY_CLOSED_STATUSES as readonly string[]).includes(normalizeIssueStatus(status));
}

/**
 * Predicado SQL «la incidencia sigue pendiente» sobre el alias dado. Los estados son literales de
 * este archivo, nunca entrada del usuario, y el alias lo escribe el código que llama.
 */
export function pendingIssueSql(alias: string): string {
  const closed = DATA_QUALITY_CLOSED_STATUSES.map((status) => `'${status}'`).join(',');
  return `LOWER(COALESCE(${alias}.issue_status, 'open')) NOT IN (${closed})`;
}
