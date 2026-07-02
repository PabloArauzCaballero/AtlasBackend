# ATLAS External Data Providers — V6 Quality Hardening

## Objetivo

Esta versión no añade un proveedor nuevo. Refuerza la calidad sistémica de lo ya construido para reducir riesgos de largo plazo cuando ATLAS empiece a consultar proveedores reales con costo y datos sensibles.

## Cambios principales

### 1. Protección contra reutilización incorrecta de idempotency keys

Antes, si un cliente reutilizaba la misma `x-idempotency-key` con otro payload o provider, el backend podía devolver el resultado anterior. En proveedores externos eso es peligroso porque puede causar:

- replay de una consulta equivocada,
- decisiones con datos de otro flujo,
- doble costo oculto,
- trazabilidad confusa.

Ahora, cuando existe una solicitud previa con la misma key, el backend compara:

- provider,
- customer,
- query type,
- purpose,
- decision stage,
- hash del input.

Si algo cambia, responde `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST` y obliga a usar una key nueva.

### 2. Tenant scoping en lectura y operaciones críticas

Se endurecieron accesos para que las operaciones por `requestId` validen también `tenantId`:

- detalle de solicitud externa,
- aprobación manual,
- retry,
- rebuild de features.

Esto evita exposición cruzada entre tenants y reduce riesgo operacional cuando el sistema escale.

### 3. Auditoría de idempotencia

Nuevo endpoint:

```http
GET /api/v1/admin/external-providers/idempotency-audit?days=30&limit=5000
```

Detecta reutilización de idempotency keys y clasifica hallazgos:

- `LOW`: replay de la misma solicitud.
- `HIGH`: misma key usada para solicitudes distintas.

### 4. Migración de hardening

Nueva migración:

```txt
src/database/migrations/20260702043000-hardening-external-providers-v6.ts
```

Agrega índices para:

- auditoría de idempotencia,
- búsqueda por tenant/request,
- intento de índice único por tenant + idempotency key si no existen duplicados históricos.

La migración es defensiva: si hay duplicados históricos, no rompe el deploy; deja el endpoint de auditoría para limpiar antes de crear unicidad estricta.

## Endpoints nuevos

```http
GET /api/v1/admin/external-providers/idempotency-audit?days=30&limit=5000
```

## Validaciones ejecutadas

```bash
tsx/tsc build
eslint
prettier --check
jest --runInBand
```

Resultado esperado:

```txt
TypeScript: OK
Lint: OK
Format: OK
Tests: OK
```

## Riesgos de largo plazo corregidos

1. Reutilización accidental de idempotency keys con payload distinto.
2. Replay incorrecto de respuestas externas.
3. Posible acceso cross-tenant por requestId global.
4. Doble costo por retries mal identificados.
5. Migraciones frágiles ante datos históricos duplicados.

## Pendiente real

- Ejecutar `idempotency-audit` contra la base real.
- Si no hay hallazgos HIGH, confirmar que el índice único quedó creado.
- Si hay hallazgos HIGH, limpiar duplicados históricos antes de imponer unicidad estricta.
