# External Providers Resilience v3

## Circuit breaker

El circuit breaker evita cascadas cuando un proveedor externo empieza a fallar.

Variables:

```env
EXTERNAL_PROVIDER_CIRCUIT_BREAKER_ENABLED=true
EXTERNAL_PROVIDER_CIRCUIT_BREAKER_FAILURE_THRESHOLD=5
EXTERNAL_PROVIDER_CIRCUIT_BREAKER_WINDOW_MS=600000
```

No se aplica en `mock_local`. Sí aplica en `mock_server`, `sandbox` y `production`.

## Idempotencia

Toda consulta de proveedor debe usar `x-idempotency-key`. Si se repite la clave, el backend recupera el resultado anterior y evita otra llamada externa.

## Preflight obligatorio en producción

Para providers con costo `HIGH` o `CRITICAL`, el frontend/panel admin debe llamar primero a:

```http
POST /api/v1/external-data/requests/preview
```

## Consentimiento faltante

Si falta consentimiento, se guarda un request con `CONSENT_REQUIRED`. Esto no consulta al proveedor, pero deja evidencia de intento bloqueado.
