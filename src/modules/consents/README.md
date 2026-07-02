# Módulo Consents

Responsabilidad: lectura de documentos legales activos y persistencia interna de consentimientos.

Endpoint activo:

- `GET /api/v1/consent-documents/active`

Los consentimientos del onboarding inicial se registran dentro de:

- `POST /api/v1/customer-onboarding/start`

No exponer `POST /customers/:customerId/consents` como contrato público en esta fase.
