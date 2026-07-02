# Módulo Sessions

Responsabilidad: persistencia interna de dispositivos, sesiones, vínculos cliente-dispositivo y snapshots.

Este módulo no registra controller público en esta fase. Sus repositories son usados por el caso de uso compuesto:

- `POST /api/v1/customer-onboarding/start`

No exponer endpoints fragmentados como:

- `POST /api/v1/customers/:customerId/sessions`
- `GET /api/v1/customers/:customerId/sessions`

Las lecturas agregadas de sesión deben salir por:

- `GET /api/v1/customers/:customerId/me`
- `GET /api/v1/operations/customers/:customerId/investigation-summary`
