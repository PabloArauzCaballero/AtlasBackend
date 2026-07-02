# Stress test — eventos y notificaciones

Este documento describe cómo validar la resistencia básica del flujo:

```txt
POST /operations/events
→ outbox_events
→ POST /operations/jobs/process-events
→ NotificationOrchestrator
→ notification_messages
→ notification_deliveries
→ GET /customers/:customerId/notifications
```

## Qué mide

El script `scripts/stress/notifications.stress.ts` mide:

- creación concurrente de eventos de negocio;
- latencia p50, p95 y p99 de creación;
- procesamiento por batches mediante `process-events`;
- throughput aproximado de procesamiento;
- fallos de creación;
- fallos de procesamiento;
- verificación exacta por `correlationId/runId` en endpoints de operaciones;
- cantidad mínima esperada de notificaciones `in_app` generadas.

Por defecto usa el evento `user.email.verified`, porque genera solo `in_app`. Ese es el mejor primer escenario para aislar la cola y el core sin depender de email, push, SMS o WhatsApp.

## Revisión de calidad aplicada

La versión auditada corrige estas deficiencias del primer script:

- la verificación ya no depende solo de `from=<fecha>`, porque eso podía mezclar resultados de pruebas simultáneas;
- se agregaron filtros por `correlationId` en `GET /operations/events` y `GET /operations/notifications/messages`;
- se permite usar tokens reales con `STRESS_ADMIN_TOKEN` y `STRESS_CUSTOMER_TOKEN` para staging/ambiente objetivo;
- se agregó timeout HTTP para evitar procesos colgados;
- se agregó retry controlado para errores transitorios `408`, `429`, `500`, `502`, `503` y `504`;
- se agregó umbral opcional de p95 de creación;
- se agregó validación explícita de eventos fallidos;
- se normaliza `BASE_URL` para evitar doble slash.


## Revisión adicional Patch 2.4

Se hizo una segunda auditoría pensando en ejecución real con `yarn` y concurrencia:

- `process-events` ahora reclama eventos con `FOR UPDATE SKIP LOCKED` antes de procesarlos, evitando doble procesamiento cuando dos operadores o workers ejecutan el job al mismo tiempo.
- `process-events` solo reclama eventos registrados en el catálogo central de eventos; los eventos técnicos quedan para `process-outbox`.
- `process-outbox` ahora respeta `_tenant_id` para no procesar outbox de otros tenants por accidente.
- El stress test valida que `STRESS_PROCESS_BATCH` no supere el límite real del endpoint (`500`) y que `STRESS_VERIFY_PAGE_LIMIT` no supere `100`.
- La documentación y los mensajes de scripts fueron corregidos a `yarn`.

## Importante sobre rate limit

El backend tiene throttling global. Para pruebas de estrés controladas, sube temporalmente el límite antes de levantar el servidor:

PowerShell:

```powershell
$env:API_RATE_LIMIT_MAX="200000"
$env:API_RATE_LIMIT_TTL_MS="60000"
yarn start:dev
```

Bash:

```bash
API_RATE_LIMIT_MAX=200000 API_RATE_LIMIT_TTL_MS=60000 yarn start:dev
```

No uses esos valores en producción pública.

## Prueba pequeña local

PowerShell:

```powershell
$env:STRESS_EVENTS="100"
$env:STRESS_CREATE_CONCURRENCY="10"
$env:STRESS_PROCESS_BATCH="50"
$env:STRESS_PROCESS_ROUNDS="10"
yarn stress:notifications
```

Bash:

```bash
STRESS_EVENTS=100 STRESS_CREATE_CONCURRENCY=10 STRESS_PROCESS_BATCH=50 STRESS_PROCESS_ROUNDS=10 yarn stress:notifications
```

## Prueba local más fuerte

PowerShell:

```powershell
$env:STRESS_EVENTS="1000"
$env:STRESS_CREATE_CONCURRENCY="25"
$env:STRESS_PROCESS_BATCH="200"
$env:STRESS_PROCESS_ROUNDS="20"
yarn stress:notifications
```

Bash:

```bash
STRESS_EVENTS=1000 STRESS_CREATE_CONCURRENCY=25 STRESS_PROCESS_BATCH=200 STRESS_PROCESS_ROUNDS=20 yarn stress:notifications
```

## Prueba en ambiente objetivo

Configura `BASE_URL` si el backend no está en localhost.

Si el script se ejecuta desde una máquina que no tiene el mismo `JWT_ACCESS_TOKEN_SECRET` del ambiente objetivo, usa tokens reales:

PowerShell:

```powershell
$env:BASE_URL="https://staging-api.atlas.com/api/v1"
$env:TENANT_ID="1"
$env:CUSTOMER_ID="1"
$env:STRESS_ADMIN_TOKEN="<jwt-admin-o-system>"
$env:STRESS_CUSTOMER_TOKEN="<jwt-del-customer-de-prueba>"
$env:STRESS_EVENTS="5000"
$env:STRESS_CREATE_CONCURRENCY="50"
$env:STRESS_PROCESS_BATCH="500"
$env:STRESS_PROCESS_ROUNDS="30"
yarn stress:notifications
```

Bash:

```bash
BASE_URL=https://staging-api.atlas.com/api/v1 \
TENANT_ID=1 \
CUSTOMER_ID=1 \
STRESS_ADMIN_TOKEN=<jwt-admin-o-system> \
STRESS_CUSTOMER_TOKEN=<jwt-del-customer-de-prueba> \
STRESS_EVENTS=5000 \
STRESS_CREATE_CONCURRENCY=50 \
STRESS_PROCESS_BATCH=500 \
STRESS_PROCESS_ROUNDS=30 \
yarn stress:notifications
```

## Variables soportadas

| Variable | Default | Uso |
|---|---:|---|
| `BASE_URL` | `http://localhost:<APP_PORT>/<API_PREFIX>` | URL base del backend |
| `TENANT_ID` | `1` | Tenant de prueba |
| `CUSTOMER_ID` | `1` | Customer que recibirá notificaciones |
| `STRESS_ADMIN_TOKEN` | vacío | JWT real admin/system para ambiente remoto |
| `STRESS_CUSTOMER_TOKEN` | vacío | JWT real del customer de prueba para ambiente remoto |
| `STRESS_EVENTS` | `500` | Cantidad de eventos a crear |
| `STRESS_CREATE_CONCURRENCY` | `20` | Concurrencia de creación de eventos |
| `STRESS_PROCESS_BATCH` | `100` | Límite por llamada a `process-events` |
| `STRESS_PROCESS_ROUNDS` | `50` | Máximo de rondas de procesamiento |
| `STRESS_IDLE_ROUNDS_TO_STOP` | `2` | Rondas vacías antes de detenerse |
| `STRESS_PROCESS_ROUND_DELAY_MS` | `100` | Pausa entre rondas de procesamiento |
| `STRESS_EVENT_CODE` | `user.email.verified` | Evento a publicar |
| `STRESS_AGGREGATE_TYPE` | `customer` | Aggregate type del evento |
| `STRESS_EXPECT_MESSAGES_PER_EVENT` | `1` | Mensajes mínimos esperados por evento |
| `STRESS_MAX_CREATE_ERROR_RATE_PCT` | `1` | Error rate máximo tolerado en creación |
| `STRESS_MAX_PROCESS_FAILED` | `0` | Eventos fallidos permitidos durante procesamiento |
| `STRESS_MAX_P95_CREATE_MS` | `0` | Umbral opcional de p95 en creación; `0` desactiva |
| `STRESS_HTTP_TIMEOUT_MS` | `30000` | Timeout por request HTTP |
| `STRESS_HTTP_RETRIES` | `2` | Reintentos por errores transitorios |
| `STRESS_HTTP_RETRY_BASE_DELAY_MS` | `250` | Delay base entre reintentos |
| `STRESS_VERIFY_PAGE_LIMIT` | `100` | Límite usado al consultar totales de verificación |

## Escenarios recomendados

### Escenario 1 — Core puro, recomendado primero

```txt
STRESS_EVENT_CODE=user.email.verified
STRESS_AGGREGATE_TYPE=customer
STRESS_EXPECT_MESSAGES_PER_EVENT=1
```

Valida creación, outbox, procesamiento y bandeja interna sin proveedores externos.

### Escenario 2 — Flujo con varios canales

```txt
STRESS_EVENT_CODE=installment.due_soon
STRESS_AGGREGATE_TYPE=installment
STRESS_EXPECT_MESSAGES_PER_EVENT=3
```

Úsalo cuando email/push estén configurados con un provider real o webhook de prueba. Si están deshabilitados, los deliveries externos pueden fallar correctamente por configuración faltante. En ese caso ajusta `STRESS_MAX_PROCESS_FAILED` solo si estás probando tolerancia a fallos; para validar core puro debe quedar en `0`.

## Criterio de éxito

Para considerar estable el flujo base:

- `create.failed = 0`, o menor al error rate tolerado;
- `process.processed >= STRESS_EVENTS`;
- `process.failed <= STRESS_MAX_PROCESS_FAILED`;
- `verification.createdEventsByCorrelation >= STRESS_EVENTS`;
- `verification.failedEventsByCorrelation <= STRESS_MAX_PROCESS_FAILED`;
- `verification.inAppMessagesByCorrelation >= STRESS_EVENTS * STRESS_EXPECT_MESSAGES_PER_EVENT`;
- p95 de creación dentro del objetivo definido para el ambiente, si `STRESS_MAX_P95_CREATE_MS` fue configurado.

## Qué NO prueba todavía

Este script no reemplaza una prueba de carga completa de infraestructura. No mide CPU, RAM, IOPS ni saturación de conexiones de PostgreSQL. Para eso, corre la prueba en el ambiente objetivo junto con métricas de base de datos, logs de API y monitoreo de proceso.

## Riesgo arquitectónico observado

El worker actual es DB-backed y procesa mediante endpoint. Para MVP está bien. Para procesamiento concurrente real con varios workers, el siguiente endurecimiento debería ser:

```txt
SELECT ... FOR UPDATE SKIP LOCKED
```

o migrar a:

```txt
PostgreSQL outbox_events → BullMQ/Redis o AWS SQS → workers separados
```
