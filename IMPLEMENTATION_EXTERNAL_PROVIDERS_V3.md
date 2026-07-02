# ATLAS External Data Providers v3 — auditoría, preflight y resiliencia

## Alcance v3

Esta fase continúa la arquitectura v1/v2 y agrega controles de operación a largo plazo. El objetivo ya no es solo exponer adapters, sino evitar los problemas típicos de producción: consultas costosas accidentales, proveedores caídos, reintentos duplicados, falta de trazabilidad cuando no hay consentimiento y falta de un tablero de preparación por proveedor.

## Cambios principales

### 1. Preflight / dry-run de consultas externas

Nuevo endpoint general:

```http
POST /api/v1/external-data/requests/preview
```

Nuevo endpoint admin equivalente:

```http
POST /api/v1/admin/external-providers/policy/preview
```

Estos endpoints calculan si una consulta se ejecutaría o no, sin llamar al proveedor y sin guardar respuesta. Devuelven:

- proveedor,
- query type,
- etapa,
- modo,
- consentimiento requerido/encontrado,
- política de costo,
- cuota,
- circuit breaker,
- hash del payload,
- input sanitizado,
- `wouldExecute`.

Uso recomendado: ejecutar preview antes de InfoCenter, Digital Trust costoso, SEGIP productivo, telcos productivos o banca real.

### 2. Auditoría de consentimiento faltante

Antes, si faltaba consentimiento, la ejecución podía cortarse antes de crear trazabilidad. Ahora se crea `data_provider_request` con:

```txt
response_status = CONSENT_REQUIRED
response_code = CONSENT_REQUIRED
```

Esto deja evidencia auditable sin consultar al proveedor.

### 3. Idempotency replay mejorado

Si llega el mismo `x-idempotency-key`, ahora el backend no devuelve una respuesta vacía: intenta recuperar las observaciones y features normalizadas desde la respuesta previamente guardada.

Esto evita dobles cargos, dobles llamadas a SEGIP/InfoCenter y estados inconsistentes en retries del cliente móvil o panel interno.

### 4. Circuit breaker por proveedor

Se agregó guardia preventiva para no seguir golpeando proveedores caídos.

Variables:

```env
EXTERNAL_PROVIDER_CIRCUIT_BREAKER_ENABLED=true
EXTERNAL_PROVIDER_CIRCUIT_BREAKER_FAILURE_THRESHOLD=5
EXTERNAL_PROVIDER_CIRCUIT_BREAKER_WINDOW_MS=600000
```

Regla:

- si un provider acumula demasiados fallos recientes (`FAILED`, `PROVIDER_UNAVAILABLE`, `PROVIDER_AUTH_FAILED`, `RATE_LIMITED`), el sistema bloquea temporalmente la ejecución con `PROVIDER_UNAVAILABLE` y reason code `PROVIDER_CIRCUIT_BREAKER_OPEN`.
- se omite para `mock_local` para no romper desarrollo local.
- aplica a `mock_server`, `sandbox` y `production`.

### 5. Readiness dashboard

Nuevo endpoint:

```http
GET /api/v1/admin/external-providers/readiness
```

Devuelve por provider:

- modo actual,
- health,
- políticas,
- fallos recientes,
- si está listo para mock,
- si está listo para production,
- blockers detectados.

### 6. Quality audit endpoint

Nuevo endpoint:

```http
GET /api/v1/admin/external-providers/quality-audit
```

Evalúa reglas de calidad:

- adapters faltantes,
- providers sensibles sin consentimiento,
- providers sin políticas de costo,
- providers costosos sin bloqueo/manual approval,
- policies sin etapas permitidas,
- providers en modo production cuando están marcados como mock/sandbox.

Devuelve score, rating y quality gates.

## Problemas de largo plazo corregidos

| Riesgo | Corrección v3 |
|---|---|
| Consultar InfoCenter por error | Preflight + política de costo + bloqueo por defecto |
| Reintentos duplicados | Replay idempotente con features previas |
| Proveedor caído genera cascada de errores | Circuit breaker por provider |
| Falta de consentimiento sin auditoría | Request CONSENT_REQUIRED guardado |
| No saber si un provider está listo para producción | Readiness dashboard |
| Configuración insegura silenciosa | Quality audit endpoint |
| Scoring acoplado a providers | Se mantiene feature snapshot como frontera |

## Endpoints nuevos v3

```http
POST /api/v1/external-data/requests/preview
POST /api/v1/admin/external-providers/policy/preview
GET  /api/v1/admin/external-providers/readiness
GET  /api/v1/admin/external-providers/quality-audit
```

## Scripts nuevos

```bash
yarn audit:external-providers
yarn smoke:external-providers:all
```

## Validación esperada

```bash
yarn type-check
yarn lint
yarn format:check
yarn test
yarn audit:external-providers
```

## Pendiente real

No se implementó integración productiva real con SEGIP, InfoCenter, bancos, QR, telcos, Meta o WhatsApp porque eso requiere credenciales/documentación/contrato. La arquitectura queda lista y protegida para conectar proveedores reales sin rehacer scoring ni el core BNPL.
