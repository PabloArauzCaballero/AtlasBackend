# External Providers Endpoints v5

## Governance de producción

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/v1/admin/external-providers/production-gate` | Compuestra de producción: readiness + quality + sanitization |
| GET | `/api/v1/admin/external-providers/sla` | Métricas SLA/SLO por proveedor |

## Decisión y scoring

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/v1/external-data/users/:customerId/decision-package` | Paquete auditable para riesgo/manual review |
| POST | `/api/v1/admin/external-providers/requests/:requestId/rebuild-features` | Regenera features sin volver a consultar provider |

## Parámetros útiles

`production-gate`:

```txt
providerCode opcional
strict=true|false
```

`sla`:

```txt
providerCode opcional
days=30
```

`decision-package`:

```txt
includeRawResponses=false
featureMaxAgeHours opcional
```

Por defecto `includeRawResponses=false`. Mantenerlo así en operaciones normales.
