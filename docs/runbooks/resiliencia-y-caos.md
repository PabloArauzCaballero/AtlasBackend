# Resiliencia: catálogo de fallos, caos y recuperación

Manual operativo del backend Atlas ante fallos parciales. Para la respuesta a incidentes de seguridad
ver `runbooks/incident-response.md`; para el procedimiento de despliegue,
`runbooks/despliegue-produccion.md`. Aquí se cubre lo que se rompe solo: dependencias caídas, procesos
muertos a la mitad, colas que no drenan y recursos que no se liberan.

El diagnóstico y las correcciones que originan este documento están en
`docs/audit/hardening-resiliencia-2026-08-05.md`.

---

## 1. Señales: qué mirar y qué significa

Todas se exponen en `/metrics` (API) y en el puerto de sonda del worker
(`WORKER_PROBE_PORT`, `/metrics`).

| Señal | Consulta | Qué significa | Acción |
| --- | --- | --- | --- |
| Worker ausente | `absent(atlas_app_info{role="worker"})` | Ningún proceso ejecuta trabajo de fondo. **Silencioso**: nadie recibe un error | §3.1 |
| Job atascado | `increase(atlas_scheduled_job_runs_total{outcome="stalled"}[15m]) > 0` | Una tanda superó su techo. Ese job **no volverá a correr** hasta que termine | §3.2 |
| Job solapado | `rate(atlas_scheduled_job_runs_total{outcome="skipped"}[1h])` alto y sostenido | El intervalo configurado es menor que la duración real del job | §3.3 |
| Job fallando | `rate(atlas_scheduled_job_runs_total{outcome="failure"}[15m]) > 0` | Fallo por tenant. El detalle está en `system_job_runs` | §3.4 |
| Backlog de outbox | `atlas_outbox_pending_events` creciendo de forma monótona | El consumo no da abasto o el worker está caído | §3.1 / §3.3 |
| Eventos rescatados | Log `Eventos varados recuperados` con `selected > 0` | **Un proceso murió a mitad de una entrega.** Nunca es rutina | §3.5 |
| Breaker abierto | `atlas_circuit_breaker_state == 2` | Un proveedor externo está caído; se corta antes de llamar | §3.6 |
| Timeout de consulta | 5xx con SQLSTATE `57014` en el log (`db:query_timeout`) | Una consulta superó `DB_STATEMENT_TIMEOUT_MS` | §3.7 |
| Pool sin conexiones | SQLSTATE `53300` (`db:too_many_connections`) | `instancias × DB_POOL_MAX` supera el límite del rol | §3.7 |
| Escritura por el pool read | SQLSTATE `25006` (`db:read_only_transaction`) | Bug de enrutamiento CQRS. **Siempre es culpa nuestra** | §3.8 |
| Privilegio ausente | SQLSTATE `42501` (`db:insufficient_privilege`) | Grants mal aplicados tras una migración | §3.8 |
| Latencia | `histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))` | p99 por ruta | §3.7 |

Los SQLSTATE se clasifican en `src/common/database/postgres-error.ts`; los marcados
`operatorFault: true` se registran con una línea `[db:<kind>]` propia aunque el cliente reciba un 5xx
opaco.

---

## 2. Catálogo de errores

### 2.1 Contrato HTTP

Todo error sale por `HttpExceptionFilter` con la forma
`{ requestId, error: { code, message, issues? }, timestamp }`. `requestId` es el correlation id y es
la clave para cruzar la respuesta con el log.

| HTTP | `code` | Origen | Recuperable | Acción del cliente |
| --- | --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Zod (`ZodValidationPipe`) | No | Corregir el cuerpo; `issues` dice qué campo |
| 401 | `UNAUTHORIZED` | `JwtAuthGuard` | Sí | Renovar el token |
| 403 | `FORBIDDEN` | `RolesGuard`, `TenantGuard`, ownership | No | El actor no tiene acceso al recurso |
| 404 | `NOT_FOUND` | Repositorios | No | — |
| 409 | `CONFLICT` | `23505`, `23503`, `40001`, `40P01`, idempotencia | **Depende** | En `40001`/`40P01` reintentar es correcto; en el resto no |
| 409 | `IDEMPOTENCY_CONFLICT` | Misma clave con cuerpo distinto | No | Usar otra `X-Idempotency-Key` |
| 409 | `IDEMPOTENCY_REQUEST_IN_PROGRESS` | Petición en vuelo con la misma clave | Sí | Reintentar tras el lock (5 min) |
| 413 | `PAYLOAD_TOO_LARGE` | `API_JSON_BODY_LIMIT` | No | Partir el lote |
| 422 | `UNPROCESSABLE_ENTITY` | `23502`, `23514` | No | Falta un campo o viola una regla |
| 429 | `RATE_LIMIT_EXCEEDED` | `ThrottlerGuard` | Sí | Backoff |
| 500 | `INTERNAL_ERROR` | No controlado, `42501`, `25006` | — | **Operador**, no cliente |
| 503 | `SERVICE_UNAVAILABLE` | `REQUEST_TIMEOUT_EXCEEDED`, `53300`, clase `08` | Sí | Backoff con jitter |
| 504 | `GATEWAY_TIMEOUT` | `57014` | Sí | Backoff |

**Ningún error es silencioso.** 5xx se registra con stack y causa del driver; 4xx con `warn`. El SQL
nunca se registra: Sequelize inlinea valores y en un backend KYC eso sería fuga de PII
(`sanitizeUrlForLog` aplica el mismo criterio a la query string).

### 2.2 Errores de la cola de eventos (`outbox_events.error_code`)

| Código | Significado | Estado resultante | Recuperación |
| --- | --- | --- | --- |
| `EVENT_PROCESSING_FAILED` | El handler lanzó | `pending` con backoff, o `failed` al agotar intentos | Automática mientras queden intentos |
| `EVENT_LOCK_EXPIRED` | El proceso que lo reclamó murió sin resolverlo | `pending` (con intentos) o `failed` | Automática vía `reclaim_stuck_events` |

Backoff: `min(60, attempts²)` minutos (`events.service.ts`). Intentos por defecto: 3
(`maxAttempts`). Un evento en `failed` es dead-letter: solo sale con
`POST /events/:id/retry`, que repone el presupuesto de intentos.

### 2.3 Errores de adaptadores de salida (`AdapterError.code`)

`TIMEOUT` y los errores de red son `retryable: true` y alimentan el retry con backoff exponencial y
jitter (`retry.util.ts`); `CIRCUIT_OPEN` es `retryable: false` — el breaker cortó antes de llamar, y
por tanto tampoco hubo coste con el proveedor.

---

## 3. Procedimientos

### 3.1 El worker no está corriendo

**Síntoma.** `absent(atlas_app_info{role="worker"})`; `atlas_outbox_pending_events` sube sin bajar.

1. Confirmar que el proceso existe y que su sonda responde:
   `curl -s localhost:$WORKER_PROBE_PORT/health/readiness`.
2. Si responde `not_ready`, mirar `checks`: es Postgres o Redis, no el worker (→ §3.7).
3. Si no responde, revisar el log de arranque. Causas frecuentes:
   - `APP_ROLE=api` en el manifiesto del worker → el proceso sale con código 1 a propósito
     (`worker.ts`).
   - `RUNTIME_JOBS_SCHEDULER_ENABLED=false` → arranca pero no programa nada; lo dice en el log.
   - Producción sin `REDIS_URL` → **no arranca el planificador por diseño**: sin lock distribuido no
     hay forma de impedir que N instancias procesen el mismo lote.
4. **Mientras se recupera**, los jobs se pueden disparar a mano contra la API con rol
   `admin`/`platform_admin`/`system`:
   `POST /api/v1/operations/jobs/process-events` con `{"dryRun": false, "limit": 100}`,
   `x-tenant-id` y `x-idempotency-key`. Es el mismo código, no un camino paralelo.

### 3.2 Un job quedó atascado (`outcome="stalled"`)

El log dice cuál y cuánto lleva. **Ese job no volverá a ejecutarse hasta que la tanda termine** — es
deliberado: se prefiere un job detenido y ruidoso a uno duplicado y silencioso.

1. Buscar consultas bloqueadas:
   ```sql
   SELECT pid, state, wait_event_type, now() - query_start AS duracion
   FROM pg_stat_activity
   WHERE state <> 'idle' AND now() - query_start > interval '5 minutes'
   ORDER BY duracion DESC;
   ```
2. Buscar bloqueos entre transacciones (`pg_locks` con `granted = false`).
3. Si la causa es un proveedor externo sin respuesta, mirar `atlas_circuit_breaker_state`.
4. Con `DB_STATEMENT_TIMEOUT_MS` activo, una consulta colgada se aborta sola pasado el techo. Si el
   atasco persiste **más allá** de ese techo, la causa no está en la base: es el adaptador de salida.
5. Último recurso: reiniciar el worker. Los eventos que estuvieran reclamados quedan varados y los
   recupera `reclaim_stuck_events` en la siguiente tanda (§3.5). **No hay pérdida.**

### 3.3 Tandas solapadas (`outcome="skipped"` sostenido)

El intervalo es más corto que la duración real del job. Dos salidas, en este orden:

1. **Reducir el trabajo por tanda**: bajar `RUNTIME_JOBS_BATCH_LIMIT`. Tandas más cortas y frecuentes
   drenan igual y sostienen mejor.
2. **Ampliar el intervalo** del job concreto. Ojo: `RUNTIME_JOBS_LEADER_LOCK_TTL_MS` acota el TTL del
   lock a `min(intervalo, techo)`, así que ampliar el intervalo también amplía la ventana en la que
   una instancia muerta retiene el liderazgo.

Si el backlog (`atlas_outbox_pending_events`) crece a la vez, el problema no es la cadencia sino la
capacidad: escalar réplicas de worker. El liderazgo por Redis garantiza que solo una ejecuta cada
tanda, así que **más réplicas dan disponibilidad, no throughput**. Para throughput hay que subir
`RUNTIME_JOBS_BATCH_LIMIT` y acortar el intervalo.

### 3.4 Un job falla para algún tenant

Un tenant que falla no cancela a los demás. La evidencia está en la base:

```sql
SELECT job_code, status, started_at, completed_at, error_message, result_json
FROM system_job_runs
WHERE status = 'failed' AND started_at > now() - interval '1 day'
ORDER BY started_at DESC;
```

### 3.5 Eventos varados recuperados

Cualquier ejecución de `reclaim_stuck_events` con `selected > 0` significa que **un proceso murió a
mitad de una entrega**. Es una anomalía, no rutina.

1. El log lista los IDs recuperados y cuántos volvieron a la cola frente a cuántos cayeron a
   dead-letter.
2. Correlacionar con reinicios: un despliegue explica un pico puntual; picos recurrentes sin
   despliegue apuntan a OOM o a que el orquestador mata el contenedor (revisar `SHUTDOWN_DRAIN_MS`
   frente al `terminationGracePeriod`).
3. Los que cayeron a `failed` requieren decisión humana:
   ```sql
   SELECT _id, event_code, attempts, max_attempts, last_error, failed_at
   FROM outbox_events
   WHERE status = 'failed' AND failed_at > now() - interval '1 day';
   ```
   Reencolar con `POST /api/v1/events/:id/retry` (repone el presupuesto de intentos).
4. Inspección manual del inventario varado:
   ```sql
   SELECT locked_by, count(*), min(locked_at)
   FROM outbox_events
   WHERE status = 'processing'
   GROUP BY locked_by;
   ```
   Un `locked_by` con `locked_at` antiguo es un worker que ya no existe.

### 3.6 Proveedor externo caído (breaker abierto)

Comportamiento esperado, no incidente: tras 5 fallos consecutivos el circuito se abre 60 s y las
llamadas se cortan antes de salir (`resilient-adapter-executor.service.ts`). Pasado ese plazo pasa a
`half_open` y una llamada de prueba decide si cierra o vuelve a abrir.

- Si es un proveedor de **notificaciones**, los mensajes quedan en `pending`/`sending` y los recoge
  `retry_stuck_notifications` cada 5 minutos. No se pierde ninguno.
- Si es un proveedor de **datos externos** (KYC, buró), la petición del cliente falla en el momento.
  Es correcto: servir evidencia inventada acabaría persistida como features del cliente y alimentando
  el motor de riesgo (por eso `EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION` es `false`).

### 3.7 Saturación: pool, timeouts y latencia

| Síntoma | Causa probable | Acción |
| --- | --- | --- |
| SQLSTATE `53300` | `instancias × DB_POOL_MAX` supera el `CONNECTION LIMIT` del rol | Bajar `DB_POOL_MAX` o subir el límite del rol (`docs/database/postgres-roles.md`) |
| SQLSTATE `57014` frecuente | Consulta legítima por encima del techo | **Medir antes de subir el techo**: `pg_stat_statements` dice qué consulta y por qué. Subirlo sin medir reintroduce A-01 |
| 503 `REQUEST_TIMEOUT_EXCEEDED` | Handler por encima de `REQUEST_TIMEOUT_MS` | Ver la ruta en `http_request_duration_seconds` |
| Readiness en `unreachable` con la base viva | Pool agotado: el probe no consigue conexión en `HEALTH_DB_PING_TIMEOUT_MS` | Es la señal correcta. Mirar `pg_stat_activity` |

`REQUEST_TIMEOUT_MS` (30 s) debe ser **menor** que `DB_STATEMENT_TIMEOUT_MS` (60 s): así la petición
se rinde antes de que la base mate la consulta y el cliente recibe un 503 del servicio en vez de un
error de driver.

### 3.8 Fallos de aprovisionamiento (`42501`, `25006`)

Nunca son culpa del cliente y por eso se registran con su propia línea aunque la respuesta sea 500.

- `42501`: a `atlas_app_rw` le falta un GRANT, casi siempre tras una migración que creó objetos
  nuevos. Verificar con `yarn check:db-privileges --strict`.
- `25006`: una **escritura salió por la conexión de lectura**. Es la violación de CQRS que la
  separación de pools existe para cazar. El pool read no debe usarse en auth, outbox, idempotencia,
  riesgo transaccional ni read-after-write.

---

## 4. Chaos engineering

Escenarios ejecutables en preproducción. **Ninguno se ha ejecutado todavía**: están descritos con su
comportamiento esperado, derivado del código, y el resultado real debe anotarse al ejercitarlos.
Ejecutar siempre uno a uno, con `/metrics` a la vista.

| ID | Escenario | Inyección | Comportamiento esperado | Criterio de éxito |
| --- | --- | --- | --- | --- |
| CH-01 | Worker muerto a mitad de tanda | `kill -9` al worker durante `process_events` | Eventos quedan en `processing`; el siguiente `reclaim_stuck_events` los devuelve a la cola | Cero eventos en `processing` con `locked_at` anterior al corte, pasados 15 min. **Cero duplicados entregados** |
| CH-02 | Postgres inalcanzable | Cortar el acceso de red al primario | Readiness → 503 en < 2 s (no en 30 s); la instancia sale del balanceador; al volver, se recupera sin reinicio | El probe responde en < `HEALTH_DB_PING_TIMEOUT_MS`; sin `unhandledRejection` en el log |
| CH-03 | Redis caído | Detener Redis | Rate limit degrada fail-open; el planificador **se salta las tandas** en vez de correr sin lock; readiness → `not_ready` | Ningún job corre sin liderazgo; sin comandos encolados (`enableOfflineQueue: false`) |
| CH-04 | Consulta colgada | `SELECT pg_sleep(120)` desde un handler | La petición devuelve 503 a los 30 s; Postgres aborta la consulta a los 60 s y **libera la conexión** | `DB_POOL_MAX` no se agota tras N peticiones colgadas |
| CH-05 | Job más lento que su intervalo | Retrasar artificialmente `process_outbox` | La tanda siguiente se salta (`skipped`); al superar el techo, se reporta `stalled` | Cero ejecuciones solapadas; la métrica `stalled` aparece |
| CH-06 | Proveedor externo caído | Apuntar un adaptador a un puerto muerto | Retry con backoff; breaker abre tras 5 fallos; `atlas_circuit_breaker_state == 2` | El breaker cierra solo al restablecer el proveedor |
| CH-07 | Proveedor lento (no caído) | Latencia de 60 s en el mock | Timeout por intento (30 s) → `AdapterError TIMEOUT` retryable → alimenta el breaker | El intento no queda colgado indefinidamente |
| CH-08 | Despliegue bajo carga | `SIGTERM` con tráfico activo | Readiness → 503 de inmediato; se drena `SHUTDOWN_DRAIN_MS`; las peticiones en curso terminan | **Cero 5xx** atribuibles al despliegue |
| CH-09 | Transacción abandonada | `BEGIN` sin `COMMIT` desde un cliente que se mata | `idle_in_transaction_session_timeout` la aborta y libera los locks | Sin locks retenidos pasados 60 s |
| CH-10 | Reintento duplicado del cliente | Repetir un `POST` con la misma `X-Idempotency-Key` | Réplica de la respuesta original, sin segundo efecto | Una sola fila creada; misma respuesta y mismo estado |
| CH-11 | Arranque simultáneo de N réplicas | Escalar de 1 a 5 workers de golpe | El jitter reparte el primer tick; un solo líder por job | Sin pico sincronizado en Redis |
| CH-12 | Payload corrupto en un evento | Alterar `event_payload_json` a mano | El handler falla → backoff → dead-letter tras agotar intentos | El evento acaba en `failed` con `last_error`; **no bloquea la cola** |

Regla de aceptación común a todos: **ningún escenario puede terminar con datos inconsistentes,
efectos duplicados ni un fallo sin registrar.**

---

## 5. Recuperación ante desastres (DRP)

**Objetivos.** RPO y RTO no están fijados por contrato todavía; los siguientes son los que el diseño
actual soporta y deben confirmarse con negocio.

| Escenario | Estrategia | RPO soportado | RTO estimado |
| --- | --- | --- | --- |
| Pérdida de una instancia de API | El balanceador la retira por readiness | 0 | Segundos |
| Pérdida del worker | Ningún dato se pierde: las colas están en Postgres. Al volver, drena el backlog y rescata lo varado | 0 | Minutos |
| Pérdida de Redis | Rate limit degrada fail-open; el planificador se detiene por diseño. **No hay estado de negocio en Redis** | 0 | Minutos |
| Pérdida del primario Postgres | Promoción de réplica + repunte de `DB_HOST` | Según el lag de replicación | Según el proveedor |
| Corrupción lógica de datos | `point-in-time recovery` | Según la retención de WAL | Horas |
| Pérdida de la clave KMS | **Sin recuperación**: la PII cifrada con envelope encryption queda ilegible | — | — |

**Orden de arranque tras un desastre.** Postgres → migraciones (`atlas_migrator`) → Redis → API →
worker. El worker al final a propósito: si arranca antes que la API con un esquema a medio migrar,
empieza a mutar datos sobre un modelo que aún no está completo.

**Verificación post-recuperación.**
1. `GET /health/readiness` en API y worker: ambos `ready`.
2. `yarn check:db-privileges --strict`: los grants sobreviven a la promoción de una réplica pero no
   siempre a una restauración.
3. `atlas_outbox_pending_events` debe **bajar** en las primeras tandas. Si sube, el worker no está
   consumiendo.
4. Revisar `outbox_events` en `processing` con `locked_by` de workers que ya no existen — se rescatan
   solos, pero el conteo indica cuánto trabajo quedó a medias.

---

## 6. Continuidad operativa (BCP)

Qué sigue funcionando cuando cae cada pieza:

| Pieza caída | Sigue funcionando | Se degrada | Se detiene |
| --- | --- | --- | --- |
| Worker | Toda la API | Entrega diferida de notificaciones; retención de datos | Trabajo de fondo |
| Redis | API completa (rate limit local por instancia) | Rate limiting deja de ser distribuido | Planificador (por diseño) |
| Réplica de lectura | API completa | Consultas de `read_api` caen al primario o fallan | — |
| Proveedor KYC | Todo lo que no lo consulta | Onboarding que requiere verificación externa | — |
| Proveedor de correo/SMS | Todo | Avisos se acumulan en `pending` y se entregan al volver | — |
| MailSender | Todo lo demás | PIN de login de administradores (si `AUTH_LOGIN_PIN_ENABLED`) | — |
| Mongo (log-sync) | Todo | Sincronización de logs; se pausa sola tras N fallos | — |
| Postgres primario | Nada | — | Todo |

**Degradación deliberada.** El pool de lectura **no** decide el readiness: si la réplica cae, marcar
`not_ready` sacaría del balanceador a todo el despliegue —incluidos escritura, auth y onboarding, que
siguen sanos— convirtiendo una degradación parcial en una caída total.

---

## 7. Checklists

### 7.1 Production ready

- [ ] `APP_ROLE` distinto en API y worker; ambos desplegados y visibles en `atlas_app_info`
- [ ] `REDIS_URL` configurado (obligatorio en producción para el liderazgo de jobs)
- [ ] `SHUTDOWN_DRAIN_MS` > intervalo del readiness probe del orquestador
- [ ] `REQUEST_TIMEOUT_MS` < `DB_STATEMENT_TIMEOUT_MS`
- [ ] `instancias × DB_POOL_MAX` ≤ `CONNECTION LIMIT` del rol `atlas_app_rw`
- [ ] `DB_MIGRATION_USER` distinto de `DB_USER` (el runtime no debe poder alterar el esquema)
- [ ] `KMS_KEY_ID` + `AWS_REGION` configurados (sin ellos la PII se cifra con clave derivada de env)
- [ ] `API_DOCS_ENABLED` desactivado o tras red aislada
- [ ] `/metrics` no expuesto a Internet
- [ ] `RUNTIME_JOBS_TICK_TIMEOUT_MS` calibrado contra la duración real del job más lento
- [ ] `DB_STATEMENT_TIMEOUT_MS` calibrado con `pg_stat_statements`, no a ojo

### 7.2 SRE

- [ ] Alerta: `absent(atlas_app_info{role="worker"})`
- [ ] Alerta: `increase(atlas_scheduled_job_runs_total{outcome="stalled"}[15m]) > 0`
- [ ] Alerta: `rate(atlas_scheduled_job_runs_total{outcome="failure"}[15m]) > 0`
- [ ] Alerta: `atlas_outbox_pending_events` creciendo de forma monótona durante 30 min
- [ ] Alerta: `atlas_circuit_breaker_state == 2` sostenido
- [ ] Alerta: log `[db:insufficient_privilege]` o `[db:read_only_transaction]` (siempre es un bug propio)
- [ ] Alerta: `reclaim_stuck_events` con `selected > 0`
- [ ] Alerta: p99 de latencia y tasa de 5xx por ruta
- [ ] Dashboard con las series de este documento
- [ ] Runbook enlazado desde cada alerta

### 7.3 DevOps

- [ ] Liveness → `/health/liveness`; readiness → `/health/readiness` (nunca al revés: liveness no
      comprueba dependencias a propósito, para que una base lenta no provoque reinicios en cascada)
- [ ] `terminationGracePeriod` > `SHUTDOWN_DRAIN_MS` + margen para las peticiones en curso
- [ ] Puerto de sonda del worker publicado solo hacia dentro
- [ ] `APP_VERSION`, `APP_COMMIT_SHA`, `APP_BUILT_AT` inyectados en el build
- [ ] Migraciones como paso previo al despliegue, con la identidad de migración
- [ ] Rollback probado: la imagen anterior debe arrancar contra el esquema nuevo

### 7.4 QA

- [ ] `yarn type-check`, `type-check:tests`, `lint`, `format:check`, `test:unit`, `build`
- [ ] `yarn check:file-size`, `check:env-example`, `check:tenant-header`, `check:migrations`
- [ ] Migración `up → down → up` contra base real
- [ ] Smokes de auth y RBAC con credenciales inyectadas
- [ ] Escenarios CH-01 a CH-12 ejecutados en preproducción, con resultado anotado
- [ ] Ningún gate crítico sin ejecutar antes de declarar "listo para producción"

---

## 8. Referencias

- `docs/audit/hardening-resiliencia-2026-08-05.md` — diagnóstico y correcciones
- `docs/audit/auditoria-integral-2026-07-30.md` — hallazgos A-03 (planificador) y A-07 (drenado)
- `docs/architecture/background-processing.md` — separación de roles de proceso
- `docs/database/postgres-roles.md` — identidades y límites de conexión
- `docs/observability/overview.md` — inventario de métricas y trazas
- `docs/runbooks/incident-response.md` — incidentes de seguridad
- `docs/runbooks/despliegue-produccion.md` — procedimiento de despliegue
