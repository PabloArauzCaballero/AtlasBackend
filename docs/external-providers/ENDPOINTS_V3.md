# External Providers Endpoints v3

## Preflight / dry-run

### POST `/api/v1/external-data/requests/preview`

Valida consentimiento, política de costo, cuotas y circuit breaker sin ejecutar el proveedor.

Body igual a `/api/v1/external-data/requests`.

Respuesta esperada:

```json
{
  "providerCode": "INFOCENTER",
  "queryType": "CREDIT_REPORT",
  "decisionStage": "ONBOARDING",
  "modeUsed": "mock_local",
  "wouldExecute": false,
  "status": "CONSENT_REQUIRED",
  "reasonCode": "CONSENT_REQUIRED",
  "estimatedCostAmount": "0.0000",
  "currency": "BOB"
}
```

### POST `/api/v1/admin/external-providers/policy/preview`

Mismo preflight, pensado para risk/compliance/admin antes de autorizar providers costosos.

## Readiness

### GET `/api/v1/admin/external-providers/readiness`

Devuelve readiness por provider:

- modo,
- health,
- policies,
- fallos recientes,
- blockers,
- `readyForMock`,
- `readyForProduction`.

## Quality audit

### GET `/api/v1/admin/external-providers/quality-audit`

Devuelve score y findings de calidad. Debe revisarse antes de pasar proveedores a sandbox/production.

Reglas auditadas:

- provider sin adapter,
- sensitive provider sin consentimiento,
- provider sin cost policy,
- provider HIGH/CRITICAL sin bloqueo,
- política sin etapas permitidas,
- modo production con provider mock/sandbox.

## Uso recomendado antes de proveedores reales

1. Crear consentimiento.
2. Ejecutar `/requests/preview`.
3. Revisar `wouldExecute` y `reasonCode`.
4. Si es costoso, aprobar manualmente.
5. Ejecutar `/requests` con `x-idempotency-key`.
6. Revisar `/requests/:requestId`.
7. Revisar `/users/:customerId/features`.
