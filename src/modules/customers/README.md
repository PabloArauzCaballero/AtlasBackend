# Módulo Customers

Responsabilidad: lecturas agregadas del cliente.

Endpoint activo:

- `GET /api/v1/customers/:customerId/me`

Este módulo no crea clientes. El registro inicial se realiza mediante el caso de uso compuesto:

- `POST /api/v1/customer-onboarding/start`

No agregar aquí endpoints CRUD por tabla.
