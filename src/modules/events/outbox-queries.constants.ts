/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza garantiza que ningún evento de negocio se procese dos veces ni se pierda.
 * @system concentra el SQL de reclamo y recuperación de la cola de eventos.
 */

/**
 * SQL de la cola de eventos (`outbox_events`).
 *
 * Vive aparte del repositorio por dos razones. La primera es de tamaño: son las dos consultas más
 * largas del módulo y hacían que `events.repository.ts` cruzara el límite del gate. La segunda es
 * más importante: son las dos sentencias donde se juegan las garantías de la cola —exactamente un
 * consumidor por evento y ninguna pérdida ante una muerte del proceso—, y leerlas juntas deja ver
 * que son la misma pieza en dos momentos: una toma el evento, la otra lo devuelve si nadie lo soltó.
 *
 * Ambas usan `FOR UPDATE SKIP LOCKED` sobre un CTE de candidatos: dos consumidores concurrentes se
 * reparten filas en vez de bloquearse mutuamente, y ninguno espera al otro.
 */

/**
 * Reclama eventos pendientes para un worker.
 *
 * El `UPDATE` marca `processing`, sella `locked_by`/`locked_at` y CONSUME un intento en la misma
 * sentencia que selecciona: si la escritura no ocurre, el evento no se considera reclamado. Que
 * `attempts` suba al reclamar (y no al fallar) es deliberado — un proceso que muere sin resolver el
 * evento ya gastó una oportunidad, y así un fallo que mata el proceso una y otra vez no puede
 * reintentarse infinitamente.
 */
export const CLAIM_PENDING_EVENTS_SQL = `
  WITH candidates AS (
    SELECT _id
    FROM outbox_events
    WHERE status = 'pending'
      AND event_code IN (:eventCodes)
      AND COALESCE(available_at, now()) <= now()
      AND (:tenantId IS NULL OR _tenant_id = CAST(:tenantId AS BIGINT))
    ORDER BY priority DESC NULLS LAST, available_at ASC NULLS FIRST, _id ASC
    LIMIT :limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE outbox_events AS event
  SET status = 'processing',
      locked_at = :now,
      locked_by = :workerId,
      attempts = COALESCE(event.attempts, 0) + 1,
      _updated_at = :now
  FROM candidates
  WHERE event._id = candidates._id
  RETURNING event._id AS id;
`;

/**
 * Devuelve a la cola los eventos varados en `processing`.
 *
 * El destino depende del presupuesto de intentos que `CLAIM_PENDING_EVENTS_SQL` ya consumió: si
 * quedan intentos vuelve a `pending` disponible ahora; si no, cae a `failed`, que es el estado de
 * dead-letter del que un operador lo saca a mano. Nunca se pierde: cambia de cola.
 *
 * `available_at` solo se pisa en la rama que reencola. En la rama de dead-letter se conserva el
 * valor original, que es evidencia de cuándo debió procesarse.
 */
export const RECLAIM_STUCK_EVENTS_SQL = `
  WITH stuck AS (
    SELECT _id
    FROM outbox_events
    WHERE status = 'processing'
      AND locked_at IS NOT NULL
      AND locked_at < :olderThan
      AND (:tenantId IS NULL OR _tenant_id = CAST(:tenantId AS BIGINT))
    ORDER BY locked_at ASC
    LIMIT :limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE outbox_events AS event
  SET status = CASE
        WHEN COALESCE(event.attempts, 0) >= COALESCE(event.max_attempts, 3) THEN 'failed'
        ELSE 'pending'
      END,
      locked_at = NULL,
      locked_by = NULL,
      available_at = CASE
        WHEN COALESCE(event.attempts, 0) >= COALESCE(event.max_attempts, 3) THEN event.available_at
        ELSE :now
      END,
      failed_at = CASE
        WHEN COALESCE(event.attempts, 0) >= COALESCE(event.max_attempts, 3) THEN :now
        ELSE event.failed_at
      END,
      error_code = 'EVENT_LOCK_EXPIRED',
      last_error = :lastError,
      _updated_at = :now
  FROM stuck
  WHERE event._id = stuck._id
  RETURNING event._id AS id, event.status AS status;
`;

/** Mensaje que queda en `last_error` de un evento recuperado. Explica el porqué a quien lo audite. */
export const EVENT_LOCK_EXPIRED_MESSAGE = 'EVENT_LOCK_EXPIRED: el proceso que reclamó el evento no lo resolvió antes del corte de bloqueo.';
