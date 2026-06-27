# Módulo Operations

Primera fase de endpoints internos de solo lectura para operaciones.

## Endpoints

- `GET /api/v1/operations/manual-review-cases`
- `GET /api/v1/operations/fraud-cases`

## Decisión de alcance

No se implementan cambios de estado de revisión manual ni fraude porque las transiciones, permisos y reglas operativas todavía no están cerradas. Esta fase permite inspección controlada y paginada sin modificar el negocio.
