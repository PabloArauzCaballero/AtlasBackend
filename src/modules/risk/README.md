# Módulo Risk

Responsabilidad futura: evaluación y explicación de riesgo.

En esta fase no expone rutas. El endpoint fragmentado `GET /api/v1/customers/:customerId/risk/latest` fue eliminado del contrato público.

Lecturas actuales relacionadas a riesgo:

- `GET /api/v1/customers/:customerId/me`
- `GET /api/v1/operations/customers/:customerId/investigation-summary`

Endpoint recomendado para una fase posterior:

- `POST /api/v1/customers/:customerId/risk-assessments`
