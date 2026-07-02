# External Providers Endpoints V4

## External-data

```http
POST /api/v1/external-data/requests/preview
POST /api/v1/external-data/requests
GET /api/v1/external-data/requests/:requestId
GET /api/v1/external-data/users/:customerId/observations
GET /api/v1/external-data/users/:customerId/features
GET /api/v1/external-data/users/:customerId/scoring-input
```

### Cache

`POST /requests` soporta `forceRefresh: true` para omitir cache. La cache solo se usa si la política del provider define `cache_ttl_seconds > 0`.

## Admin

```http
GET /api/v1/admin/external-providers/readiness
GET /api/v1/admin/external-providers/quality-audit
GET /api/v1/admin/external-providers/usage?days=30
GET /api/v1/admin/external-providers/retention/preview?days=90&limit=100
GET /api/v1/admin/external-providers/sanitization-audit?limit=100
PATCH /api/v1/admin/external-providers/:providerCode/runtime
POST /api/v1/admin/external-providers/:providerCode/kill-switch
POST /api/v1/admin/external-providers/requests/:requestId/approve
POST /api/v1/admin/external-providers/requests/:requestId/retry
```

## Runtime patch example

```json
{
  "defaultMode": "mock_server",
  "providerStatus": "ACTIVE",
  "isActive": true,
  "reason": "QA con mock server"
}
```

Para production:

```json
{
  "defaultMode": "production",
  "confirmProductionReady": true,
  "reason": "Contrato y credenciales aprobadas"
}
```

## Kill switch example

```json
{
  "reason": "Proveedor con timeouts y alto costo no esperado"
}
```

## Retry example

```json
{
  "providerCode": "SEGIP",
  "queryType": "IDENTITY_VERIFICATION",
  "purpose": "KYC_ONBOARDING",
  "decisionStage": "ONBOARDING",
  "customerId": "1",
  "input": {
    "documentNumber": "1234567",
    "firstName": "Pablo",
    "lastName": "Arauz"
  }
}
```

## Nota de privacidad

El retry exige reenviar input porque ATLAS no guarda payloads claros originales. Esta decisión es intencional y reduce riesgo legal.
