# Runbook · copia de Mensajería al piloto y lectura sombra (AT-058)

Herramienta: `yarn tsx scripts/messaging/backfill-pilot.ts --target-schema <destino> [--prepare] [--watermark ISO] [--batch 500]
[--reconcile-only]` (identidad de migración: el destino se crea con `LIKE … INCLUDING ALL`). Prueba:
`test/integration/messaging/pilot-backfill.spec.ts`. Librería: `src/modules/notifications/infrastructure/pilot/messaging-backfill.ts`.

## Qué hace y qué no

- Copia **sólo** las seis tablas de `messaging` (una tabla ajena se rechaza) por lotes ascendentes de `_id`, con punto de control
  en `<destino>.backfill_checkpoints` **en la misma transacción** que el lote. Si se corta, se reanuda desde el último id.
- Marca de agua: `_created_at <= watermark`. Lo que llega después se incorpora en la siguiente pasada (catch-up) con una
  marca nueva. **No hay CDC de actualizaciones**: una fila ya copiada que cambia después (estado de una entrega) no se
  vuelve a copiar. Por eso la última pasada se hace con el relay drenado y el dueño en pausa (paso 3 del corte).
- Reconciliación por tabla: conteos, ids que faltan/sobran (`EXCEPT`) y hash encadenado de filas. Sale con código 2 si hay
  diferencias sin explicar. El informe no contiene datos en claro.
- Lectura sombra: `shadowReadSummary` sólo hace SELECT sobre el destino; no existe adaptador ni proveedor en ese camino,
  y la prueba comprueba que el hash del origen no cambia.

## Procedimiento

1. `--prepare` una vez (DDL). 2. Pasadas de copia con marca de agua = ahora, hasta que la reconciliación quede limpia.
3. Drenar (runbook de corte, paso 3), última pasada, reconciliación final. 4. Sólo entonces, transferencia de propiedad.

## Permisos y retención

El comparador debería correr con un rol de sólo lectura sobre el origen; hoy usa la identidad de migración porque el destino
es un schema de la misma base (sin base propia del piloto). La evidencia de reconciliación se guarda con la ejecución y se
borra con la ventana de transición.

## Rollback

Mientras el piloto no sea escritor, el destino se descarta (`DROP SCHEMA <destino> CASCADE`); el origen y los puntos de
control no se tocan.
