# Hardening de resiliencia — API y workers (2026-08-05)

Auditoría de tolerancia a fallos del backend Atlas y de sus trabajos de fondo, con las correcciones
aplicadas en la misma pasada. El alcance es el runtime completo: `src/main.ts` (API), `src/worker.ts`
(worker), el planificador de trabajos, la cola de eventos, los pools de PostgreSQL y las sondas de
salud.

Método: lectura de código con evidencia `archivo:línea`, más los gates reales del repositorio. No se
ejecutó nada contra una base de datos real ni contra producción, así que todo lo relativo a latencia,
volumen o comportamiento bajo carga real queda marcado como **no verificado**.

---

## 1. Resumen por área

| Área | Estado antes | Estado después | Hallazgos abiertos |
| --- | --- | --- | --- |
| Cola de eventos (outbox) | Pérdida permanente de eventos tras una muerte del proceso | Rescate automático + dead-letter explícito | — |
| Planificador de trabajos | Solapamiento posible; atasco silencioso; arranque sincronizado | Guard de reentrada, watchdog alertable, jitter | R-07 (aceptado) |
| Pools de PostgreSQL | Sin techo de sentencia: una consulta colgada retiene su conexión para siempre | `statement_timeout` + `idle_in_transaction_session_timeout` | — |
| Sondas de salud | El ping de Postgres podía colgarse tanto como el `acquire` del pool | Techo propio en API y worker | — |
| Reintento manual de eventos | Sin presupuesto de intentos: moría al primer fallo | Repone `attempts` y suelta el bloqueo | — |
| Ciclo de vida del proceso | Ya correcto (drenado, readiness 503, handlers globales) | Sin cambios | — |
| Resiliencia de salida (proveedores) | Ya correcta (retry + jitter + breaker + timeout por intento) | Sin cambios | R-11, R-12 (aceptados) |
| Idempotencia HTTP | Ya correcta (índice único + carrera cubierta + expiración de lock) | Sin cambios | — |

---

## 2. Hallazgos

### C-01 · Crítica · Pérdida permanente y silenciosa de eventos de dominio

**Evidencia.** `src/modules/events/events.repository.ts:166` (`claimPending`) marcaba el evento como
`processing` con `locked_by`/`locked_at` en una transacción propia. La resolución —`processed`,
`pending` con backoff o `failed`— ocurría después, en otra escritura, en
`src/modules/events/events.service.ts:172-204`. Toda consulta de reclamo filtra por
`status = 'pending'`: `listPending` (`events.repository.ts:146`) y el propio `claimPending`.

**Fallo.** Si el proceso muere entre ambas escrituras (despliegue, `SIGKILL`, OOM, pérdida de la
conexión), el evento queda en `processing` para siempre. Nadie vuelve a mirarlo: no hay error, no hay
alerta, no hay fila en ninguna cola de fallidos. Un aviso de KYC o de crédito simplemente nunca sale.
Era la única cola del sistema con pérdida permanente — las notificaciones varadas sí tenían barrido
(`runtime-maintenance-jobs.service.ts`), y las claves de idempotencia expiran solas por `lockedUntil`
(`runtime-hardening.service.ts:34`).

**Impacto.** Pérdida de mensajes · incumplimiento de aviso al cliente · imposible de detectar sin
inspeccionar la tabla a mano.

**Corrección.** `EventsRepository.reclaimStuckProcessing` (`events.repository.ts`) +
`EventsService.reclaimStuckEvents` (`events.service.ts`), expuestos como el job
`reclaim_stuck_events` (`scheduled-jobs.catalog.ts`) y como
`POST /operations/jobs/reclaim-stuck-events` (`runtime-jobs.controller.ts`). El criterio de "varado"
es temporal (`RUNTIME_JOBS_STUCK_EVENT_MINUTES`, 15 min por defecto) y no de proceso: no hay forma de
saber si el `locked_by` sigue vivo, y un registro de workers sería otra cosa más que puede quedar
desincronizada. El destino depende del presupuesto de intentos que el reclamo ya consumió: con
intentos restantes vuelve a `pending`; sin ellos cae a `failed`, que es el estado de dead-letter del
que un operador lo saca con `POST /events/:id/retry`. Nunca se pierde: cambia de cola.

**Validación.** `test/unit/events/reclaim-stuck-events.spec.ts` (7 casos).
**Monitoreo.** `atlas_scheduled_job_runs_total{job="reclaim_stuck_events"}` y el log
`Eventos varados recuperados` con los IDs. Cualquier ejecución con `selected > 0` significa que un
proceso murió a medias: es una anomalía, no rutina.
**Rollback.** `RUNTIME_JOBS_STUCK_EVENTS_INTERVAL_MS` muy alto desactiva el job de hecho; el resto del
sistema queda como estaba.

### A-01 · Alta · Una consulta colgada retiene su conexión del pool indefinidamente

**Evidencia.** `src/config/database.config.ts` construía `dialectOptions.options` solo con
`search_path`. `RequestTimeoutInterceptor` (`src/common/interceptors/request-timeout.interceptor.ts`)
declara como propósito evitar exactamente esto, pero `timeout` de RxJS desuscribe el Observable y
devuelve 503 **sin cancelar la consulta**: el socket sigue esperando y la conexión sigue ocupada.

**Fallo.** N peticiones lentas agotan `DB_POOL_MAX` aunque todas hayan respondido ya al cliente. La
degradación deja de ser local al endpoint lento y se lleva por delante a toda la API — incluidos auth
y los probes.

**Corrección.** `statement_timeout` e `idle_in_transaction_session_timeout` se fijan al abrir cada
sesión de los pools de **runtime** (escritura y lectura). Las **migraciones quedan fuera** a
propósito: un DDL o un backfill legítimo dura más que cualquier petición y matarlo a la mitad deja un
esquema a medio aplicar. Los defaults (60 s) son deliberadamente mayores que `REQUEST_TIMEOUT_MS`
(30 s): la petición debe rendirse antes de que la base mate la consulta, para que el 503 sea del
servicio y no un error de driver.

**Validación.** `test/unit/config/database-session-timeouts.spec.ts` (5 casos, incluida la exclusión
de migraciones).
**Monitoreo.** SQLSTATE `57014` ya está clasificado como `query_timeout` con `operatorFault: true` en
`src/common/database/postgres-error.ts:128`, así que un techo que se dispara alerta en vez de pasar
por un 500 anónimo.
**Rollback.** `DB_STATEMENT_TIMEOUT_MS=0` y `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS=0` restauran el
comportamiento previo exacto.

### A-02 · Alta · El readiness probe podía colgarse justo cuando su respuesta era más valiosa

**Evidencia.** `src/modules/health/health.controller.ts` protegía Redis y el pool de lectura con
`Promise.race`, pero `checkPostgres()` llamaba a `sequelize.authenticate()` sin techo. Lo mismo en
`src/worker/worker-probe-server.ts`.

**Fallo.** Con el pool agotado, `authenticate()` espera hasta `DB_POOL_ACQUIRE_MS` (30 s) por una
conexión. Como el orquestador sondea cada pocos segundos, los sondeos se acumulan en la misma cola
que el tráfico real: el probe pasa de detectar la saturación a alimentarla, y el orquestador acaba
matando la instancia por timeout de probe sin que quede registrado por qué.

**Corrección.** `probeWithTimeout` en ambos procesos, gobernado por `HEALTH_DB_PING_TIMEOUT_MS`
(2 s). Un probe debe responder rápido y mal antes que lento y bien. De paso se eliminó la triplicación
del mismo `Promise.race` en el controlador.

**Validación.** `test/unit/health/health.controller.spec.ts`, sección «techo de tiempo del sondeo».

### M-01 · Media · Una tanda podía solaparse consigo misma

**Evidencia.** `runtime-jobs-scheduler.service.ts` armaba `setInterval(() => void this.tick(job), job.intervalMs)`.
El lock de liderazgo usa `ttlMs = Math.min(job.intervalMs, RUNTIME_JOBS_LEADER_LOCK_TTL_MS)`, es decir
**expira justo cuando llega el siguiente tick**.

**Fallo.** Si una tanda dura más que su intervalo, la siguiente arranca encima —en la misma instancia
y en cualquier otra—. `FOR UPDATE SKIP LOCKED` protege las filas reclamadas, pero no el resto del
trabajo: entregas a proveedores, contadores y escrituras derivadas sí se duplican. Bajo carga
sostenida las tandas se acumulan hasta agotar el pool.

**Corrección.** `JobTickGuard` (`src/modules/runtime-jobs/job-tick-guard.ts`). El guard va **antes**
de pedir el liderazgo: si la tanda anterior sigue viva, esta ni consulta a Redis. Se registra como
`atlas_scheduled_job_runs_total{outcome="skipped"}` — no es un fallo, pero si domina la serie
significa que el intervalo configurado es menor que la duración real del job.

**Validación.** `test/unit/runtime-jobs/job-tick-guard.spec.ts` (10 casos) +
`runtime-jobs-scheduler.service.spec.ts`.

### M-02 · Media · Un job atascado dejaba de correr sin que nada lo reportara

**Evidencia.** Consecuencia directa de M-01: con el guard puesto, una tanda colgada bloquea su job
indefinidamente. Es el modo de fallo más caro de un planificador, porque no produce ningún error —
las políticas de retención de datos personales dejarían de aplicarse y nadie se enteraría.

**Corrección.** Watchdog en `JobTickGuard`, gobernado por `RUNTIME_JOBS_TICK_TIMEOUT_MS` (5 min). No
cancela la promesa (JavaScript no lo permite): convierte el silencio en señal, con
`atlas_scheduled_job_runs_total{outcome="stalled"}` y un log de error con el tiempo transcurrido.

**Decisión explícita.** Al vencer el watchdog **no se libera el hueco**. Liberarlo permitiría que la
tanda siguiente corriera en paralelo con la atascada, que es M-01 reintroducido en el peor momento
posible: cuando ya hay algo funcionando mal. Se prefiere un job detenido y ruidoso a uno duplicado y
silencioso. La alerta es lo que un humano acciona.

### M-03 · Media · Arranque sincronizado de todas las réplicas (thundering herd)

**Evidencia.** El bucle de `onApplicationBootstrap` armaba los `setInterval` de golpe: N réplicas que
arrancan juntas tras un despliegue disparan el mismo tick en el mismo instante, todas piden el mismo
lock a Redis y todas leen la lista de tenants.

**Corrección.** Desfase aleatorio del primer disparo (`RUNTIME_JOBS_START_JITTER_MS`, 15 s). No cambia
la cadencia: solo mueve el punto de partida de cada serie.

### M-04 · Media · El reintento manual de un evento no reintentaba nada

**Evidencia.** `EventsService.retryEvent` (`events.service.ts:129`) devolvía el evento a `pending`
pero **no reponía `attempts`**. Como `claimPending` incrementa el contador al reclamar
(`outbox-queries.constants.ts`), un evento que llegó a `failed` por agotar intentos volvía con
`attempts >= maxAttempts`: el primer fallo lo devolvía directo a `failed`.

**Corrección.** `retryEvent` repone `attempts = 0` y suelta `lockedAt`/`lockedBy`. El operador que
pulsa «reintentar» pide otra oportunidad real, no un intento único.

---

## 3. Riesgos aceptados (sin cambio de código)

| ID | Riesgo | Por qué se acepta | Cómo se vigila |
| --- | --- | --- | --- |
| R-07 | Un tenant lento retrasa a los siguientes: la tanda los recorre en serie (`runtime-jobs-scheduler.service.ts`) | En paralelo competirían por el mismo pool que atiende el tráfico HTTP. La serie es la elección correcta para trabajo de fondo | `outcome="stalled"` delata la tanda que no termina |
| R-08 | El breaker en memoria no se comparte entre réplicas (`circuit-breaker.ts:21`) | Es protección local del proceso, complementaria al breaker persistido de `external-data`. Compartirlo exigiría estado distribuido con su propio modo de fallo | `atlas_circuit_breaker_state` por proveedor |
| R-11 | Sondas concurrentes en `half_open`: varias llamadas pasan a la vez sobre un proveedor que se está recuperando (`circuit-breaker.ts:44`) | El coste es un pico breve sobre un proveedor ya degradado; limitarlo exigiría un semáforo que puede quedarse trabado | `atlas_provider_calls_total{outcome}` |
| R-12 | El retry completo cuenta como **un** fallo para el breaker (`resilient-adapter-executor.service.ts:74`) | Deliberado: el breaker mide "el proveedor está caído", no "hubo N errores de red" | idem |
| R-13 | `client.on('error')` de Redis loguea cada error (`redis.module.ts`) | Una caída prolongada genera ruido en el log, pero silenciarlo escondería la causa raíz | Volumen de log; `atlas_app_info` + readiness |
| R-14 | El outbox de `api_command` se marca `processed` en el mismo `UPDATE` que lo reclama (`runtime-jobs.service.ts:175`) | Ese outbox es trazabilidad, no entrega: no hay efecto externo que pueda fallar. El outbox **de negocio** (`process_events`) sí tiene reintento, backoff y dead-letter | `atlas_outbox_pending_events` |

---

## 4. Matriz de riesgos (FMEA)

`S` severidad, `O` ocurrencia, `D` detectabilidad (1 = se detecta solo, 10 = invisible). `RPN = S×O×D`.
La columna «después» refleja el estado tras las correcciones de este documento.

| ID | Modo de fallo | Efecto | S | O | D antes | RPN antes | Control aplicado | D después | RPN después |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C-01 | Proceso muere entre reclamo y resolución de un evento | Evento perdido para siempre; aviso al cliente nunca sale | 9 | 6 | 10 | **540** | Job `reclaim_stuck_events` + dead-letter | 2 | **108** |
| A-01 | Consulta sin fin retiene su conexión | Pool agotado → caída total de la API | 9 | 4 | 7 | **252** | `statement_timeout` en el servidor | 2 | **72** |
| A-02 | Probe colgado con el pool saturado | Instancia sana eliminada sin diagnóstico | 7 | 4 | 8 | **224** | `HEALTH_DB_PING_TIMEOUT_MS` | 2 | **56** |
| M-01 | Tanda más larga que su intervalo | Procesamiento duplicado; acumulación de tandas | 7 | 5 | 6 | **210** | `JobTickGuard` + métrica `skipped` | 2 | **70** |
| M-02 | Tanda colgada | Retención de PII deja de aplicarse en silencio | 8 | 3 | 10 | **240** | Watchdog + métrica `stalled` | 2 | **48** |
| M-03 | Réplicas sincronizadas al desplegar | Pico sobre Redis y Postgres en el peor minuto | 4 | 7 | 5 | **140** | Jitter de arranque | 3 | **84** |
| M-04 | Reintento manual sin presupuesto | El operador cree haber reintentado y no reintentó | 5 | 6 | 7 | **210** | `attempts = 0` en `retryEvent` | 2 | **60** |
| R-14 | Transacción abierta sin cerrar | Locks retenidos; escrituras ajenas bloqueadas | 8 | 3 | 8 | **192** | `idle_in_transaction_session_timeout` | 3 | **72** |

---

## 5. Árbol de fallos — «un aviso al cliente nunca sale»

```
                    Evento de negocio sin entregar
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
  No se publicó           No se procesó            Se procesó y la
   el evento               el evento               entrega falló
        │                        │                        │
        │            ┌───────────┼───────────┐            │
        │            │           │           │            │
        │      Nadie corre  Varado en   Agotó los    Proveedor caído
        │      el job       processing  intentos     (email/SMS/push)
        │            │           │           │            │
        │            │           │           │            │
     [cubierto]  [cubierto]  [CORREGIDO]  [cubierto]  [cubierto]
   Escritura     Planificador  C-01:       Dead-letter  Breaker + retry
   transaccional en el worker  reclaim_    `failed` +   con backoff y
   con el cambio + alerta      stuck_      retry        jitter; mensaje
   de negocio    `absent(      events      manual       queda `pending`
                 atlas_app_                             y lo recoge
                 info{role=                             retry_stuck_
                 "worker"})`                            notifications
```

Antes de esta pasada, la rama «varado en `processing`» era la única sin ningún control: no producía
error, no dejaba rastro accionable y no tenía forma de recuperación.

---

## 6. Cambios aplicados

| Archivo | Cambio |
| --- | --- |
| `src/config/env.schema.ts` | `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`, `HEALTH_DB_PING_TIMEOUT_MS` |
| `src/config/env.runtime-jobs.schema.ts` | `RUNTIME_JOBS_STUCK_EVENTS_INTERVAL_MS`, `RUNTIME_JOBS_STUCK_EVENT_MINUTES`, `RUNTIME_JOBS_TICK_TIMEOUT_MS`, `RUNTIME_JOBS_START_JITTER_MS` |
| `src/config/database.config.ts` | Techos de sesión en los pools de runtime; migraciones exentas |
| `src/modules/events/outbox-queries.constants.ts` | **Nuevo.** SQL de reclamo y de rescate, juntos porque son la misma pieza en dos momentos |
| `src/modules/events/events.repository.ts` | `reclaimStuckProcessing`, `countStuckProcessing` |
| `src/modules/events/events.service.ts` | `reclaimStuckEvents`; `retryEvent` repone el presupuesto de intentos |
| `src/modules/runtime-jobs/job-tick-guard.ts` | **Nuevo.** Reentrada + watchdog |
| `src/modules/runtime-jobs/scheduled-jobs.catalog.ts` | **Nuevo.** Catálogo declarativo, separado de la mecánica de ejecución |
| `src/modules/runtime-jobs/runtime-jobs-scheduler.service.ts` | Guard, jitter, `runBatch`, nuevo job |
| `src/modules/runtime-jobs/runtime-maintenance-jobs.service.ts` | `reclaimStuckEvents` con envoltura de auditoría |
| `src/modules/runtime-jobs/runtime-jobs.controller.ts` | `POST /operations/jobs/reclaim-stuck-events` |
| `src/modules/health/health.controller.ts` | `probeWithTimeout`; se elimina la triplicación del `Promise.race` |
| `src/worker/worker-probe-server.ts` | Mismo techo en la sonda del worker |
| `src/common/observability/metrics.service.ts` | Desenlaces `skipped` y `stalled` |
| `.env.example`, `.env.production.example` | Las 7 variables nuevas, documentadas |

**Compatibilidad.** Ningún contrato existente cambia: se añade un endpoint, no se modifica ninguno.
Todas las variables nuevas tienen default, así que un despliegue que no toque su configuración
adopta los techos sin intervención. `0` desactiva cada techo y restaura el comportamiento previo.

---

## 7. Evidencia de verificación

Ejecutado el 2026-08-05 sobre este árbol de trabajo:

| Gate | Resultado |
| --- | --- |
| `yarn type-check` | ✅ |
| `yarn type-check:tests` | ✅ |
| `yarn lint` | ✅ 0 errores (151 warnings preexistentes, sin variación) |
| `yarn format:check` | ✅ |
| `yarn test:unit` | ✅ 293 suites / 2529 tests (base: 287 / 2445) |
| `yarn build` | ✅ |
| `yarn check:file-size` | ✅ sin deuda nueva (ambos archivos se dividieron en vez de congelarse) |
| `yarn check:env-example` | ✅ 159 variables tipadas cubiertas |

---

## 8. No verificado

Todo lo siguiente exige una base de datos, un Redis y carga reales. Ninguna afirmación de este
documento depende de ello, pero tampoco puede darse por probado:

- Que el techo de `statement_timeout` no corta ninguna consulta legítima del runtime. **Debe medirse
  con `pg_stat_statements` antes de bajarlo de 60 s.**
- Comportamiento del rescate de eventos con un volumen alto de filas varadas (el `LIMIT` acota cada
  tanda, pero el tiempo de drenado total no se midió).
- Que `RUNTIME_JOBS_TICK_TIMEOUT_MS = 5 min` supera la duración real de la tanda más lenta
  (`apply_retention_policies` sobre un histórico grande). **Calibrar con
  `atlas_scheduled_job_runs_total{outcome="stalled"}` en preproducción antes de fijarlo.**
- Migración `up → down → up`, seeds y smokes: requieren base real.
- Los escenarios de caos de `docs/runbooks/resiliencia-y-caos.md`: están descritos y son ejecutables,
  pero **no se han ejecutado**.

---

## 9. Prioridad recomendada de seguimiento

1. **Calibrar `DB_STATEMENT_TIMEOUT_MS` con medición real** antes del primer despliegue con este
   cambio. Es el único cambio que puede rechazar trabajo legítimo si está mal dimensionado.
2. **Alertar sobre `outcome="stalled"` y sobre `selected > 0` en `reclaim_stuck_events`.** Ambas
   señales son nuevas y, sin alerta, siguen siendo silencio.
3. Ejecutar los escenarios de caos CH-01 a CH-04 en preproducción y anotar el resultado real.
4. Revisar R-11 (sondas concurrentes en `half_open`) si algún proveedor externo muestra picos al
   recuperarse.

**Trazabilidad.** Continúa `docs/audit/auditoria-integral-2026-07-30.md` (hallazgos A-03 y A-07, que
introdujeron el planificador y el drenado que aquí se endurecen).
