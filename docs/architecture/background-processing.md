# Procesamiento en segundo plano y separación de roles de proceso

> Alcance: qué trabajo del backend NO ocurre dentro de una petición HTTP, dónde se ejecuta hoy, qué
> problema tiene ejecutarlo dentro del proceso que atiende la API, y cómo queda separado en un
> proceso *worker* propio.

Documento vivo. Cada afirmación apunta a código real; si el código cambia, este archivo cambia en el
mismo PR.

---

## 1. Inventario del trabajo de fondo real

Obtenido de `setInterval` / `OnApplicationBootstrap` / entregas *fire-and-forget* en `src/`.

| # | Pieza | Archivo | Disparo actual | ¿Necesita worker? |
|---|---|---|---|---|
| 1 | Planificador de trabajos programados (<!-- fig:jobs.always -->21<!-- /fig --> siempre + <!-- fig:jobs.optional -->5<!-- /fig --> opcionales, ver abajo) | [runtime-jobs-scheduler.service.ts](../../src/modules/runtime-jobs/runtime-jobs-scheduler.service.ts) | `setInterval` por job, líder por Redis `SET NX PX`, opt-in `RUNTIME_JOBS_SCHEDULER_ENABLED` | **Sí** — es trabajo de fondo puro |
| 2 | Entrega de broadcasts de notificación | [notification-broadcast.service.ts](../../src/modules/notifications/notification-broadcast.service.ts) | *fire-and-forget* dentro del proceso que atendió el `POST` | **Sí** — hoy compite con la latencia del request |
| 3 | Monitor de salud de herramientas críticas | [systems-health-monitor.service.ts](../../src/modules/systems-ops/systems-health-monitor.service.ts) | `setInterval`, opt-in `SYSTEM_HEALTH_MONITOR_ENABLED` | **Sí** — es un observador global, no per-instancia |
| 4 | Seeding idempotente al arrancar | [startup-seed.service.ts](../../src/database/startup-seed.service.ts) | `OnApplicationBootstrap`, opt-in `DATABASE_SEED_ON_STARTUP` | **Sí** — mutación de datos, no debe correr en N réplicas de API |
| 5 | Sincronización de `Archivo.log` a MongoDB | [log-sync.service.ts](../../src/modules/log-sync/log-sync.service.ts) | `setInterval`, activo si hay `MONGO_DB_URL_CONNECTION` | **No: en TODOS los procesos** — ver §2.3 |
| 6 | Métricas del pool de conexiones | [db-pool-metrics.service.ts](../../src/common/observability/db-pool-metrics.service.ts) | `OnModuleInit`, lectura por scrape | **No: en TODOS los procesos** — mide *este* pool |
| 7 | Carga del registro de proveedores externos | [external-provider-registry.service.ts](../../src/modules/external-data/application/external-provider-registry.service.ts) | `OnModuleInit`, solo lee | **No: en TODOS los procesos** — es caché de arranque |

Además de estas siete piezas, <!-- fig:jobs.intervalSources -->9<!-- /fig --> archivos de `src/` arrancan su propio
`setInterval` fuera del planificador (tabla generada; la columna dice qué variable lo enciende o condiciona):

<!-- gen:interval-sources -->
| Archivo | Variables que lo encienden o condicionan |
|---|---|
| `src/bootstrap/messaging-relay-loop.service.ts` | — (sin variable propia: ver el archivo) |
| `src/modules/log-sync/log-sync.service.ts` | `MONGO_DB_URL_CONNECTION` |
| `src/modules/mobile-identity/identity-engine-reconciler.service.ts` | — (sin variable propia: ver el archivo) |
| `src/modules/qa-orchestration/application/qa-journey-consumer.service.ts` | — (sin variable propia: ver el archivo) |
| `src/modules/qa-orchestration/application/qa-run-execution.service.ts` | — (sin variable propia: ver el archivo) |
| `src/modules/runtime-jobs/runtime-jobs-scheduler.service.ts` | `RUNTIME_JOBS_SCHEDULER_ENABLED` |
| `src/modules/systems-ops/systems-catalog-auto-sync.service.ts` | `SYSTEMS_CATALOG_AUTO_SYNC_ENABLED` |
| `src/modules/systems-ops/systems-health-monitor.service.ts` | `SYSTEM_HEALTH_MONITOR_ENABLED` |
| `src/modules/systems-ops/systems-stress-consumer.service.ts` | — (sin variable propia: ver el archivo) |
<!-- /gen:interval-sources -->

- `systems-catalog-auto-sync` pone al día el catálogo de sistemas cada cierto tiempo si
  `SYSTEMS_CATALOG_AUTO_SYNC_ENABLED` está encendida.
- `messaging-relay-loop` es el bucle del relay del worker piloto de Mensajería (proceso aparte:
  `src/messaging-worker.ts`, `yarn start:messaging`), a `MESSAGING_RELAY_INTERVAL_MS`; sólo reclama
  eventos si `context_ownership` lo nombra dueño de Mensajería.
- Los de `qa-orchestration` y `systems-stress-consumer` son latidos DENTRO de una corrida que ya
  reclamó un trabajo programado (`consume_qa_journey_runs`, `consume_systems_stress_runs`): no programan
  trabajo por su cuenta.

### Trabajos programados del punto 1

Tablas **generadas** desde los catálogos (`yarn docs:figures`; `yarn check:docs-figures` falla en CI si el
código cambia y la tabla no). Nombre, variable de intervalo y su valor por defecto salen del código y
del esquema de entorno; nada se escribe a mano.

Corren **siempre** que el planificador está encendido (`RUNTIME_JOBS_SCHEDULER_ENABLED`) en el proceso
con trabajo de fondo:

<!-- gen:jobs-always -->
| `jobCode` | Intervalo (variable · default) | Catálogo |
|---|---|---|
| `process_outbox` | `RUNTIME_JOBS_OUTBOX_INTERVAL_MS` · 30 s | `scheduled-jobs.catalog.ts` |
| `process_events` | `RUNTIME_JOBS_EVENTS_INTERVAL_MS` · 30 s | `scheduled-jobs.catalog.ts` |
| `expire_stale_sessions` | `RUNTIME_JOBS_SESSIONS_INTERVAL_MS` · 5 min | `scheduled-jobs.catalog.ts` |
| `apply_retention_policies` | `RUNTIME_JOBS_RETENTION_INTERVAL_MS` · 24 h | `scheduled-jobs.catalog.ts` |
| `retry_stuck_notifications` | `RUNTIME_JOBS_NOTIFICATION_RETRY_INTERVAL_MS` · 5 min | `scheduled-jobs.catalog.ts` |
| `purge_idempotency_keys` | `RUNTIME_JOBS_IDEMPOTENCY_PURGE_INTERVAL_MS` · 24 h | `scheduled-jobs.catalog.ts` |
| `purge_processed_outbox` | `RUNTIME_JOBS_IDEMPOTENCY_PURGE_INTERVAL_MS` · 24 h | `scheduled-jobs.catalog.ts` |
| `mark_abandoned_onboardings` | `RUNTIME_JOBS_ONBOARDING_ABANDONMENT_INTERVAL_MS` · 24 h | `scheduled-jobs.catalog.ts` |
| `recalculate_data_quality` | `RUNTIME_JOBS_DATA_QUALITY_INTERVAL_MS` · 1 h | `scheduled-jobs.catalog.ts` |
| `sweep_support_sla` | `RUNTIME_JOBS_SUPPORT_SLA_INTERVAL_MS` · 1 min | `scheduled-jobs.catalog.ts` |
| `sweep_loan_delinquency` | `RUNTIME_JOBS_DELINQUENCY_SWEEP_INTERVAL_MS` · 1 h | `scheduled-jobs.catalog.ts` |
| `dispatch_loan_outcomes` | `RUNTIME_JOBS_OUTCOME_DISPATCH_INTERVAL_MS` · 15 min | `scheduled-jobs.catalog.ts` |
| `register_engine_facilities` | `RUNTIME_JOBS_OUTCOME_DISPATCH_INTERVAL_MS` · 15 min | `scheduled-jobs.catalog.ts` |
| `sync_engine_consents` | `RUNTIME_JOBS_OUTCOME_DISPATCH_INTERVAL_MS` · 15 min | `scheduled-jobs.catalog.ts` |
| `sweep_debt_ratings` | `RUNTIME_JOBS_RATING_SWEEP_INTERVAL_MS` · 6 h | `scheduled-jobs.catalog.ts` |
| `sync_partner_kyb_reviews` | `RUNTIME_JOBS_PARTNER_KYB_SYNC_INTERVAL_MS` · 5 min | `scheduled-jobs.catalog.ts` |
| `refresh_credit_lines` | `RUNTIME_JOBS_CREDIT_LINE_REFRESH_INTERVAL_MS` · 1 h | `scheduled-jobs.catalog.ts` |
| `process_bank_statement_reviews` | `RUNTIME_JOBS_BANK_STATEMENT_INTERVAL_MS` · 15 min | `scheduled-jobs.catalog.ts` |
| `reclaim_stuck_events` | `RUNTIME_JOBS_STUCK_EVENTS_INTERVAL_MS` · 5 min | `scheduled-jobs.catalog.ts` |
| `run_notification_campaigns` | `RUNTIME_JOBS_NOTIFICATION_CAMPAIGNS_INTERVAL_MS` · 30 s | `scheduled-jobs.catalog.ts` |
| `reconcile_submitted_credit_applications` | `RUNTIME_JOBS_CREDIT_RECONCILE_INTERVAL_MS` · 5 min | `scheduled-jobs.credit.ts` |
<!-- /gen:jobs-always -->

**Opcionales**: sólo existen si se cumple la condición (el mismo `if` que los crea en
`optional-jobs.catalog.ts`). Por defecto, en un despliegue sin configurar, **no corre ninguno** salvo
`retry_deferred_underwriting`, que depende de que la composición cablee el crédito (siempre en la
imagen actual):

<!-- gen:jobs-optional -->
| `jobCode` | Intervalo (variable · default) | Sólo existe si | Catálogo |
|---|---|---|---|
| `deliver_pending_notifications` | `RUNTIME_JOBS_NOTIFICATION_DELIVERY_INTERVAL_MS` · 10 s | `env.NOTIFICATIONS_DELIVERY_MODE === 'deferred'` | `optional-jobs.catalog.ts` |
| `retry_deferred_underwriting` | `RUNTIME_JOBS_OUTCOME_DISPATCH_INTERVAL_MS` · 15 min | `deps.creditUnderwriting` | `optional-jobs.catalog.ts` |
| `consume_systems_stress_runs` | `RUNTIME_JOBS_STRESS_CONSUMER_INTERVAL_MS` · 30 s | `env.RUNTIME_JOBS_STRESS_CONSUMER_ENABLED` | `optional-jobs.catalog.ts` |
| `deliver_erp_events` | `RUNTIME_JOBS_ERP_EVENTS_INTERVAL_MS` · 5 s | `env.ERP_EVENTS_DELIVERY_URL && env.ERP_EVENTS_DELIVERY_SECRET && deps.erpEvents` | `optional-jobs.catalog.ts` |
| `consume_qa_journey_runs` | `RUNTIME_JOBS_QA_CONSUMER_INTERVAL_MS` · 5 s | `env.RUNTIME_JOBS_QA_CONSUMER_ENABLED` | `optional-jobs.catalog.ts` |
<!-- /gen:jobs-optional -->

Las variables `RUNTIME_JOBS_*` de cada intervalo están en [Variables de entorno](../config/environment.md).

---

## 2. Problemas de ejecutar todo esto dentro del proceso de la API

### 2.1 El trabajo de fondo compite con la latencia del request

`apply_retention_policies` y `recalculate_data_quality` recorren tablas completas por tenant. Con el
planificador dentro del proceso de la API, esas consultas salen del **mismo pool de conexiones** que
atiende el tráfico de clientes y ocupan el **mismo event loop**. El efecto no es hipotético: el pool
tiene un tamaño fijo (`DB_POOL_MAX`) y un job que retiene conexiones deja al handler HTTP esperando
en la cola del pool, no en la base.

### 2.2 Escalar la API multiplica el trabajo de fondo

Con N réplicas de API, cada una arranca los mismos `setInterval` (uno por trabajo programado). La elección de líder por
Redis evita la ejecución simultánea, pero el diseño sigue acoplando dos decisiones que no tienen
nada que ver: "cuánto tráfico HTTP hay que atender" y "cuánto trabajo de fondo hay que procesar".
Separar el rol permite escalar cada uno por su propia señal.

### 2.3 Excepción deliberada: `log-sync` NO se mueve al worker

`ArchivoLogMongoSyncService` **tail-ea el archivo que escribe su propio proceso**
(`LOG_SYNC_FILE_PATH`, escrito por `AppFileLogger`). En contenedores separados, el archivo de la API
y el del worker son archivos distintos en sistemas de archivos distintos. Moverlo "al worker"
dejaría los logs de la API sin sincronizar. Por eso corre en **todos** los roles, y el `bootId` de
cada proceso ya distingue el origen de cada documento en MongoDB.

Lo mismo vale para `DbPoolMetricsService`: mide el pool *de este proceso*; en el worker mide el pool
del worker, que es justamente lo que hace falta observar.

### 2.4 Un reinicio de la API a mitad de broadcast deja mensajes varados

`broadcast()` crea las filas de `notification_messages` de forma síncrona y entrega en
*fire-and-forget* (`void this.deliverBroadcastMessages(...)`). Está bien razonado —un broadcast puede
targetear decenas de miles de destinatarios y hacerlo dentro del request lo haría durar minutos—
pero ata la entrega al ciclo de vida del proceso HTTP. Un despliegue a mitad de tanda deja mensajes
en `pending` que sólo recoge `retry_stuck_notifications`, cuyo umbral por defecto es **15 minutos**
de antigüedad y cuyo intervalo es de **5 minutos**: hasta 20 minutos de retraso para un aviso in-app.

---

## 3. Decisión de arquitectura

**Un solo artefacto, tres roles de proceso**, seleccionados por `APP_ROLE`:

| `APP_ROLE` | Sirve HTTP de negocio | Ejecuta trabajo de fondo | Uso |
|---|---|---|---|
| `api` | Sí | No | Réplicas de API en producción |
| `worker` | No (sólo sonda de salud y `/metrics`) | Sí | Contenedor de trabajo de fondo |
| `all` | Sí | Sí | Desarrollo, tests, despliegue de una sola pieza |

**`all` es el valor por defecto**: sin configurar nada, el comportamiento es exactamente el de hoy.
Ni un test, ni un script, ni un `yarn start:dev` cambian de conducta por este trabajo.

### Por qué una sola imagen y no dos

La API y el worker comparten el 100 % del árbol de dependencias (mismos modelos, mismos servicios,
misma configuración). Dos imágenes significarían dos builds, dos escaneos de vulnerabilidades y dos
oportunidades de que las versiones diverjan. Un `command` distinto sobre la misma imagen no tiene
ninguna de esas desventajas.

### Por qué el worker no monta la API HTTP

`NestFactory.createApplicationContext()` instancia todos los módulos y providers **sin registrar
ninguna ruta**. Eso significa que el worker no expone `/customers`, `/auth` ni ningún endpoint de
negocio aunque alguien alcance su puerto. Para lo único que el worker sí necesita HTTP —que el
orquestador pueda sondearlo y que Prometheus pueda hacer scrape— se levanta un servidor
`node:http` mínimo con exactamente tres rutas: `/health/liveness`, `/health/readiness` y `/metrics`.

### Por qué no se añade una cola dedicada (BullMQ, RabbitMQ…)

El trabajo de fondo de Atlas ya es **durable en PostgreSQL**: el outbox, `notification_messages`,
`system_job_runs` y `idempotency_keys` son las colas reales, con su estado y su auditoría. Una cola
externa añadiría un almacén de estado paralelo que habría que reconciliar con el que ya existe, más
una dependencia de infraestructura nueva. La regla del proyecto (`.claude/rules`, ADR de selección de
librerías) exige justificar cada dependencia; aquí no hay nada que justificar todavía.

---

## 4. Plan de acción

| Paso | Entregable | Verificación |
|---|---|---|
| 4.1 | `APP_ROLE` en `env.schema.ts` + helpers `runsBackgroundWork()` / `runsHttpApi()` en `src/config/app-role.ts` | `yarn type-check`, pruebas unitarias del helper |
| 4.2 | Gatear las piezas 1, 3 y 4 del inventario por `runsBackgroundWork()` | Pruebas: con `APP_ROLE=api` no se programa ningún timer |
| 4.3 | Entrega diferida de notificaciones (`NOTIFICATIONS_DELIVERY_MODE=deferred`) + job `deliver_pending_notifications` | Pruebas: en `deferred` el API no entrega; el job sí |
| 4.4 | `src/worker.ts` + sonda mínima `src/worker/worker-probe-server.ts` | Arranque real del worker contra Postgres/Redis del compose |
| 4.5 | Imagen y compose con servicios `api`, `worker` y `migrate` (one-shot) | `docker compose build` y `up` reales |
| 4.6 | Métrica `atlas_app_info{role}` y alerta de worker ausente | Scrape real de `/metrics` en el worker |

### 4.3 en detalle — por qué un job nuevo y no bajar el umbral del existente

`retry_stuck_notifications` responde a la pregunta *"¿qué quedó varado?"* y por eso mira mensajes
**antiguos** (15 min). `deliver_pending_notifications` responde a *"¿qué hay recién creado por
entregar?"* y mira mensajes de **cualquier antigüedad**, cada 10 s. Fusionarlos obligaría a un solo
umbral que serviría mal a los dos casos: bajarlo a 0 haría que cada tanda de "recuperación" compitiera
con la entrega normal por los mismos mensajes.

Ambos entregan por el **mismo** `NotificationOrchestratorService.deliverMessage`, que ya corta solo
si el mensaje alcanzó un estado terminal. Por eso solaparse es seguro: es la misma propiedad que ya
hacía seguro reintentar.

---

## 5. Estado de ejecución

Ver [la sección de estado del informe de auditoría](../audit/auditoria-integral-2026-07-30.md) y el
registro de pendientes en [pending-items.md](../pending/pending-items.md).
