# Protocolo de rendimiento y fallos parciales (AT-054)

**No hay benchmark aquí.** Este documento fija CÓMO se mide y qué umbrales se aprueban una vez medidos; las cifras de
abajo son mediciones locales de la matriz de fallos, no una línea base de capacidad.

## Matriz de fallos (probada: `test/integration/resilience/extraction-failure-matrix.spec.ts`)

| Fallo | Comportamiento exigido | Evidencia |
|---|---|---|
| Transporte/proveedor lento | el reclamo es una transacción corta; publicar no retiene la base; otro relay reclama y publica mientras el lento sigue | 3 eventos con 150 ms cada uno en curso; el relay rápido publicó otros 3 en **9 ms** (local, 2026-09-12) |
| Consumidor caído | el productor conserva la intención: `pending` con `available_at` futuro; al volver, se entrega **una** vez | `retried=1` → `published=1`, un solo `handle` |
| Relay muerto a medias | la fila queda `processing` hasta que el reaper `reclaim_stuck_events` (job v1, 5 min) la devuelve a `pending` y **anula `owner_token`**; otro relay la publica; el cierre tardío del muerto no toca la fila | `complete(testigo viejo)=false`, `published=1` |
| Base caída | el relay falla con error explícito; nunca «0 procesados» | `run()` rechaza |
| Probes con proveedor lento | fuera de esta suite: el probe de readiness no depende del relay (ver `docs/observability/microservices-readiness.md`) | — |

Cambio declarado (v1): `RECLAIM_STUCK_EVENTS_SQL` ahora también pone `owner_token = NULL`. v1 no lee esa columna; el
efecto es cerrar la ventana en la que un relay v2 muerto podía cerrar una fila ya recuperada.

## Protocolo de carga (pendiente de ejecutar antes del piloto, AT-062)

1. Dataset y semilla fijos (`db:seed:pull` del perfil de pruebas), mismo entorno para monolito y piloto; cold start
   separado del régimen estacionario (descartar el primer minuto).
2. Carga: el recorrido de `credit-journey` a N solicitudes/min por 10 min con 2 tenants; mismo `k6`/script para ambos
   (no existe todavía en el repo: se añade con la primera medición, no se estima).
3. Métricas: p50/p95/p99 de `POST /customers/:id/credit-applications`, errores por código, `atlas_db_pool_*`,
   `atlas_outbox_pending_events`, `atlas_outbox_relay_events_total`, CPU/memoria por proceso.
4. Fallos inyectados durante la carga: caída del consumidor (matriz), relay reiniciado, base de Mensajería en pausa.
5. Umbral de aceptación: **p95 del piloto ≤ p95 del monolito + 20 %** y backlog recuperado en < 2× el tiempo de la
   pausa; se aprueba con las cifras medidas escritas en este documento, no antes.
