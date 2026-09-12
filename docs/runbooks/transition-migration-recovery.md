# Runbook · migración de instalaciones existentes y recuperación (AT-053)

Prueba: `test/integration/migrations/transition-upgrade.spec.ts`. Helper: `src/platform/persistence/batch-backfill.ts`.

## Tres cosas distintas

| Acción | Qué revierte | Qué NO revierte | Cuándo |
|---|---|---|---|
| Rollback de aplicación (imagen anterior) | el código | la estructura ni los datos: las migraciones de la transición son **expansivas** (columnas nuevas con defecto, tabla nueva), la app anterior las ignora | fallo funcional tras desplegar |
| Reversión estructural (`yarn db:migration:down`, una por vez) | columnas/tabla de la transición | los datos de negocio; **se pierden** `inbox_receipts` (los consumidores deben ser idempotentes) y `owner_token` | sólo si la expansión rompe algo; ensayado en la prueba (down×2 → up) |
| Restauración desde copia (`pg_dump` previo) | todo, al instante de la copia | nada posterior: solicitudes, eventos, claves creadas después se pierden | corrupción; última opción |

## Ventana de compatibilidad

Mientras la expansión está aplicada y la app anterior sigue corriendo: los eventos nuevos reciben `event_id` y
`schema_version=1` por defecto; `producer`/`aggregate_version`/`owner_token` quedan NULL y el relay v1 los procesa igual.
Probado: filas sembradas «como la versión anterior» sobreviven down→up con sus estados.

## Relleno por lotes

Un backfill futuro (p. ej. `producer` de filas heredadas) usa `runBatchBackfill`: lotes ascendentes por `_id`, punto de
control persistido **en la misma transacción** que el lote, reanudación desde el punto de control. Probado: interrumpido
tras el primer lote y reanudado, cada fila se toca exactamente una vez. No hay ningún backfill obligatorio hoy.

## Grants de los roles por contexto

`inbox_receipts` se recrea en el `up` de `20260911190000`; la migración vuelve a dar a `atlas_ctx_*` (si existen) los
mismos grants que `ops/postgres/context-roles.sql`. Hallazgo de la prueba: sin eso, un down→up dejaba a Mensajería sin
permiso sobre su inbox hasta reejecutar el guion. Tras cualquier reversión estructural, `yarn check:db-privileges`.

## Procedimiento de recuperación

1. `yarn db:migration:status` — qué está aplicado.
2. Si falló a medias una migración: son idempotentes (`IF NOT EXISTS`); reejecutar `up`.
3. Si hay que bajar: `down` una por una, con la app anterior parada; verificar `SELECT count(*) FROM
   platform_ops.outbox_events WHERE status='pending'` antes y después (el número no cambia).
4. Restaurar sólo con copia verificada y aprobación; después, repetir `up` y el §1 del runbook `events-recovery-v2.md`.
