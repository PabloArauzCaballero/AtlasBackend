# ATLAS External Data Providers — V4 hardening

## Objetivo

Esta versión continúa la fase posterior a resiliencia: evita costos duplicados, agrega controles operativos de producción y prepara el consumo seguro de señales externas por scoring sin acoplarlo a proveedores.

## Cambios principales

### 1. Cache contractual por provider/query

Se agregaron columnas en `external_provider_cost_policies`:

- `cache_ttl_seconds`
- `feature_ttl_seconds`
- `retry_max_attempts`
- `retry_backoff_seconds`

Si existe una consulta reciente con el mismo `tenant`, `provider`, `customer`, `query_type` y `payload_hash`, y la política define `cache_ttl_seconds > 0`, ATLAS devuelve un resultado `CACHED` y registra una nueva solicitud auditable con `cached_from_request_id`.

Esto evita doble costo en proveedores como InfoCenter, SEGIP productivo, telcos o digital trust.

### 2. Force refresh seguro

`POST /api/v1/external-data/requests` acepta:

```json
{
  "forceRefresh": true
}
```

Esto omite cache, pero no omite consentimiento, política de costo, cuotas ni circuit breaker.

### 3. Scoring input consolidado

Nuevo endpoint:

```http
GET /api/v1/external-data/users/:customerId/scoring-input
```

Devuelve un paquete consolidado desde `risk_feature_snapshots` solamente. El scoring no recibe acceso a provider adapters ni payloads crudos.

### 4. Runtime policy / kill switch

Nuevos endpoints admin:

```http
PATCH /api/v1/admin/external-providers/:providerCode/runtime
POST /api/v1/admin/external-providers/:providerCode/kill-switch
```

Sirven para desactivar proveedores rápidamente si hay caída, error contractual, costo inesperado o incidente de privacidad.

### 5. Usage/cost dashboard

Nuevo endpoint:

```http
GET /api/v1/admin/external-providers/usage?days=30&providerCode=INFOCENTER
```

Resume total de consultas, ejecutadas, bloqueadas, cacheadas, costo estimado y costo real.

### 6. Retry seguro

Nuevo endpoint:

```http
POST /api/v1/admin/external-providers/requests/:requestId/retry
```

Por privacidad, ATLAS no guarda el input claro original. Por eso el retry exige reenviar `input`. Esto evita guardar datos sensibles crudos solo para poder reintentar.

### 7. Retention preview no destructivo

Nuevo endpoint:

```http
GET /api/v1/admin/external-providers/retention/preview?days=90&limit=100
```

No elimina datos. Lista candidatos para purga/archivo después de revisión legal/compliance.

### 8. Sanitization audit

Nuevo endpoint:

```http
GET /api/v1/admin/external-providers/sanitization-audit?limit=100
```

Escanea respuestas redacted recientes y alerta si aparecen claves sensibles no redactadas.

## Nuevas migraciones

- `20260702040000-add-external-provider-resilience-v4.ts`

## Riesgos corregidos a largo plazo

1. Doble costo por reintentos o doble click.
2. Scoring acoplado por accidente a providers.
3. Falta de kill switch operativo.
4. Activar producción sin confirmación explícita.
5. No saber cuánto cuestan los proveedores.
6. Mantener respuestas sensibles más tiempo del necesario.
7. Retry inseguro por guardar payload original claro.
8. Features viejas usadas por scoring sin advertencia.

## Pendiente real

- Credenciales/documentación SEGIP real.
- Contrato InfoCenter real.
- Contratos bancos/QR.
- Contratos telcos.
- Revisión de permisos oficiales Meta/WhatsApp.
- Job destructivo de retención aprobado por legal.
