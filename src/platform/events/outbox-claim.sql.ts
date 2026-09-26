/**
 * @file Consulta de reclamo del relay del outbox, aparte para no engordar el servicio (gate de tamaño).
 * @business Un evento pendiente lo toma UN solo relay a la vez, y sólo si sigue siendo el dueño del contexto.
 * @system `FOR UPDATE SKIP LOCKED` reparte filas entre relays; el testigo (`owner_token`) permite cerrar con
 *   fencing; la cláusula de época ata el reclamo a `platform_ops.context_ownership` (AT-059).
 */
/**
 * Reclamo con lease. La cláusula de ÉPOCA (`:ownershipContext` / `:ownershipEpoch`) cierra la ventana
 * TOCTOU que encontró la revisión independiente A (hallazgo 5): entre leer «soy dueño» y reclamar, una
 * transferencia podía colarse y dejar dos relays reclamando filas distintas a la vez. Con la época
 * dentro del mismo UPDATE, el relay viejo reclama 0 filas. Con `:ownershipContext` nulo (relay sin
 * registro de propiedad, p. ej. en pruebas) la condición no aplica y el comportamiento es el anterior.
 */
export const CLAIM_SQL = `
  WITH candidates AS (
    SELECT _id FROM platform_ops.outbox_events
    WHERE status = 'pending'
      AND aggregate_type <> 'api_command'
      AND COALESCE(available_at, now()) <= :now
      AND (:tenantId IS NULL OR _tenant_id = CAST(:tenantId AS BIGINT))
      AND (
        :ownershipContext IS NULL
        OR EXISTS (
          SELECT 1 FROM platform_ops.context_ownership o
          WHERE o.context = :ownershipContext AND o.owner = :ownershipOwner AND o.epoch = CAST(:ownershipEpoch AS BIGINT)
        )
      )
    ORDER BY priority DESC NULLS LAST, available_at ASC NULLS FIRST, _id ASC
    LIMIT :limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE platform_ops.outbox_events AS event
  SET status = 'processing', locked_at = :now, locked_by = :workerId, owner_token = :ownerToken,
      attempts = COALESCE(event.attempts, 0) + 1, _updated_at = :now
  FROM candidates WHERE event._id = candidates._id
  RETURNING event._id AS id;`;
