/**
 * ATLAS-AUDIT-025: paginación por cursor (keyset) para reemplazar `OFFSET/LIMIT` en listados
 * sobre tablas de alto crecimiento (auditoría, telemetría, colas de trabajo). El costo de un
 * `OFFSET` en PostgreSQL crece linealmente con la profundidad de la página, porque la base de
 * datos igual tiene que recorrer y descartar todas las filas anteriores al offset. Un cursor
 * por clave (`WHERE (created_at, id) < (:cursorCreatedAt, :cursorId)`) evita ese costo: cada
 * página cuesta lo mismo sin importar qué tan "profundo" se esté paginando.
 *
 * Patrón de uso (ver `events.repository.ts::listWithCursor` como referencia aplicada):
 *   1. El cliente manda un `cursor` opaco (o ninguno, para la primera página).
 *   2. `decodeCursor` lo convierte en `{ createdAt, id }`.
 *   3. El repositorio agrega `WHERE (created_at, id) < (:createdAt, :id)` a la consulta,
 *      ordenada por `created_at DESC, id DESC`, con un índice compuesto que cubra ese orden.
 *   4. Se pide `limit + 1` filas; si vuelven `limit + 1`, hay página siguiente y se recorta a
 *      `limit`, devolviendo `encodeCursor(lastRow)` como el cursor de la próxima página.
 *
 * El cursor es opaco a propósito (base64 de un JSON interno): el cliente no debe construirlo ni
 * interpretarlo, solo reenviarlo tal cual lo recibió.
 */

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

type CursorKey = { createdAt: string; id: string };

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): CursorKey | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CursorKey>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

/**
 * Dada una lista de `limit + 1` filas ya ordenadas por `createdAt DESC, id DESC`, separa la
 * página visible del indicador de "hay más". No conoce SQL: solo aplica el recorte y arma el
 * cursor siguiente a partir de la última fila visible.
 */
export function paginateWithCursor<T extends { createdAtValue: Date; id: string }>(rowsPlusOne: T[], limit: number): CursorPage<T> {
  const hasMore = rowsPlusOne.length > limit;
  const items = hasMore ? rowsPlusOne.slice(0, limit) : rowsPlusOne;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAtValue.toISOString(), id: last.id }) : null;
  return { items, nextCursor };
}
