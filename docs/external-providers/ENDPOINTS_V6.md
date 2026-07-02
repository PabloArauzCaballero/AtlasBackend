# External Providers Endpoints V6

## Nuevo endpoint de auditoría

### GET `/api/v1/admin/external-providers/idempotency-audit`

Query params:

| Campo | Tipo | Default | Uso |
|---|---:|---:|---|
| days | number | 30 | Ventana de revisión |
| limit | number | 5000 | Máximo de requests auditados |

Respuesta esperada:

```json
{
  "generatedAt": "2026-07-02T00:00:00.000Z",
  "days": 30,
  "inspectedRequests": 120,
  "findings": [],
  "score": 100,
  "qualityGate": "PASS"
}
```

Hallazgo HIGH:

```json
{
  "severity": "HIGH",
  "idempotencyKeyHash": "...",
  "message": "La misma idempotency key aparece asociada a solicitudes distintas...",
  "requests": []
}
```

## Endpoints endurecidos por tenant

Estos endpoints ahora buscan la solicitud usando `tenantId + requestId`:

```http
GET /api/v1/external-data/requests/:requestId
POST /api/v1/admin/external-providers/requests/:requestId/approve
POST /api/v1/admin/external-providers/requests/:requestId/retry
POST /api/v1/admin/external-providers/requests/:requestId/rebuild-features
```

## Regla de calidad

Para providers externos, la idempotencia debe representar exactamente la misma operación. Si cambia el provider, cliente, propósito, etapa, query type o hash del payload, la key es inválida y se rechaza.
