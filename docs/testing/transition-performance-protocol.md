# Protocolo de rendimiento y fallos parciales (AT-054)

**No hay benchmark aquí.** Este documento fija CÓMO se mide y qué umbrales se aprueban una vez medidos; las cifras de
abajo son mediciones locales de la matriz de fallos, no una línea base de capacidad.

## Matriz de fallos (probada: `test/integration/resilience/extraction-failure-matrix.spec.ts`)

| Fallo                      | Comportamiento exigido                                                                                                                                                                                      | Evidencia                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Transporte/proveedor lento | el reclamo es una transacción corta; publicar no retiene la base; otro relay reclama y publica mientras el lento sigue                                                                                      | 3 eventos con 150 ms cada uno en curso; el relay rápido publicó otros 3 en **9 ms** (local, 2026-09-12) |
| Consumidor caído           | el productor conserva la intención: `pending` con `available_at` futuro; al volver, se entrega **una** vez                                                                                                  | `retried=1` → `published=1`, un solo `handle`                                                           |
| Relay muerto a medias      | la fila queda `processing` hasta que el reaper `reclaim_stuck_events` (job v1, 5 min) la devuelve a `pending` y **anula `owner_token`**; otro relay la publica; el cierre tardío del muerto no toca la fila | `complete(testigo viejo)=false`, `published=1`                                                          |
| Base caída                 | el relay falla con error explícito; nunca «0 procesados»                                                                                                                                                    | `run()` rechaza                                                                                         |
| Probes con proveedor lento | fuera de esta suite: el probe de readiness no depende del relay (ver `docs/observability/microservices-readiness.md`)                                                                                       | —                                                                                                       |

Cambio declarado (v1): `RECLAIM_STUCK_EVENTS_SQL` ahora también pone `owner_token = NULL`. v1 no lee esa columna; el
efecto es cerrar la ventana en la que un relay v2 muerto podía cerrar una fila ya recuperada.

## Línea base local medida (2026-09-12)

Guion: `ATLAS_TEST_DATABASE_ISOLATED=true yarn perf:transition --n 100 --concurrency 10`
(`scripts/performance/transition-journey-bench.ts`). Evidencia: `docs/testing/evidence/transition-performance-2026-09-12.json`.
Máquina de desarrollo (darwin/arm64, Node 22, PostgreSQL local en docker), misma fachada de admisión que la API (sin HTTP),
relay v2 con consumidor de prueba. **No es una línea base de producción**: fija el método y el orden de magnitud.

| Régimen                   | Muestras    | p50     | p95     | p99     | Throughput                            |
| ------------------------- | ----------- | ------- | ------- | ------- | ------------------------------------- |
| Admisión secuencial       | 50          | 17,4 ms | 30,7 ms | 42,0 ms | 53,6/s                                |
| Admisión concurrente (10) | 50          | 55,7 ms | 95,2 ms | 98,4 ms | 138,8/s                               |
| Relay v2 (lotes de 100)   | 100 eventos | —       | —       | —       | 99,7 eventos/s; 100 entregados de 100 |

## Protocolo de carga (pendiente de ejecutar en staging con HTTP, AT-062)

1. Dataset y semilla fijos (`db:seed:pull` del perfil de pruebas), mismo entorno para monolito y piloto; cold start
   separado del régimen estacionario (descartar el primer minuto).
2. Carga: el recorrido de `credit-journey` a N solicitudes/min por 10 min con 2 tenants; mismo `k6`/script para ambos
   (no existe todavía en el repo: se añade con la primera medición, no se estima).
3. Métricas: p50/p95/p99 de `POST /customers/:id/credit-applications`, errores por código, `atlas_db_pool_*`,
   `atlas_outbox_pending_events`, `atlas_outbox_relay_events_total`, CPU/memoria por proceso.
4. Fallos inyectados durante la carga: caída del consumidor (matriz), relay reiniciado, base de Mensajería en pausa.
5. Umbral de aceptación: **p95 del piloto ≤ p95 del monolito + 20 %** y backlog recuperado en < 2× el tiempo de la
   pausa; se aprueba con las cifras medidas escritas en este documento, no antes.
