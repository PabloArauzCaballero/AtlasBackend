# Módulo Operations

Responsabilidad: endpoints internos agregados para operación, fraude, revisión manual e investigación.

Endpoints activos:

- `GET /api/v1/operations/work-queue`
- `GET /api/v1/operations/customers/:customerId/investigation-summary`

No exponer colas fragmentadas como endpoints principales:

- `GET /api/v1/operations/manual-review-cases`
- `GET /api/v1/operations/fraud-cases`

Ambas vistas deben agruparse desde `work-queue`.
