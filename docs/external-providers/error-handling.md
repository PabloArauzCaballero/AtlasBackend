# Manejo de errores de proveedores externos

El backend debe manejar errores sin romper onboarding ni scoring.

## Mapeo

- 401/403 -> `PROVIDER_AUTH_FAILED`
- 429 -> `RATE_LIMITED`
- 5xx -> `PROVIDER_UNAVAILABLE`
- timeout -> `PROVIDER_UNAVAILABLE`
- dato inexistente -> `NOT_FOUND` o `DATA_NOT_AVAILABLE`
- inconsistencia -> observación con `manualReviewRequired=true`

## Regla

El scoring consume `feature_snapshots`, no respuestas crudas.
