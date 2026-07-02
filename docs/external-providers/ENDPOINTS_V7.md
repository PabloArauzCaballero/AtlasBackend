# Endpoints v7 — Cambios de seguridad

La v7 no cambia contratos públicos principales. Endurece autorización y production gates.

## Endpoints afectados por ownership de customer

Los siguientes endpoints validan que un actor `customer` solo acceda a su propio `customerId`:

- `POST /api/v1/external-data/consents`
- `GET /api/v1/external-data/consents/user/:customerId`
- `POST /api/v1/external-data/requests/preview`
- `POST /api/v1/external-data/requests`
- `GET /api/v1/external-data/users/:customerId/features`
- `GET /api/v1/external-data/users/:customerId/scoring-input`
- `GET /api/v1/external-data/users/:customerId/decision-package`
- `GET /api/v1/external-data/users/:customerId/observations`
- `POST /api/v1/kyc/segip/verify`
- `POST /api/v1/payments/qr/verify`
- `POST /api/v1/payments/bank-transfer/verify`
- `POST /api/v1/telco/phone-trust/verify`
- `GET /api/v1/telco/phone-trust/:customerId`
- `GET /api/v1/social/facebook/connect-url`
- `POST /api/v1/social/facebook/callback`
- `GET /api/v1/social/facebook/status/:customerId`
- `POST /api/v1/whatsapp/verification/start`
- `POST /api/v1/whatsapp/verification/confirm`
- `GET /api/v1/whatsapp/status/:customerId`
- `POST /api/v1/digital-trust/check`
- `GET /api/v1/digital-trust/profile/:customerId`

## Revocación de consentimiento

`POST /api/v1/external-data/consents/:consentId/revoke` ahora valida ownership en el servicio si el actor es `customer`.

## Production runtime

`PATCH /api/v1/admin/external-providers/:providerCode/runtime` bloquea `defaultMode=production` si faltan condiciones técnicas mínimas.
