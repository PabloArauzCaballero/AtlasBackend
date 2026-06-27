# Módulo Consents

Gestiona documentos activos de consentimiento y eventos de consentimiento del cliente.

## Endpoints

- `GET /api/v1/consent-documents/active`
- `POST /api/v1/customers/:customerId/consents`

## Reglas aplicadas

- Se registra una fila en `customer_consents` y una fila en `consent_events` en la misma transacción.
- No se crea ninguna tabla nueva.
- No se guardan contactos de terceros ni datos no definidos en el schema.
