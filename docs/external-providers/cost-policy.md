# Política de costo de proveedores externos

La tabla `external_provider_cost_policies` controla cuándo un proveedor puede ejecutarse.

## InfoCenter

InfoCenter queda configurado como proveedor costoso:

- `cost_tier = HIGH`
- `block_by_default = true`
- `requires_manual_approval = true`
- etapas permitidas: `MANUAL_REVIEW`, `LIMIT_INCREASE`, `FRAUD_REVIEW`

Si alguien intenta consultar InfoCenter desde `ONBOARDING`, el backend devuelve:

```json
{
  "status": "BLOCKED_BY_COST_POLICY",
  "reasonCode": "INFOCENTER_HIGH_COST_REQUIRES_MANUAL_APPROVAL"
}
```

## Regla de diseño

Un proveedor caro puede existir en la arquitectura, pero no debe dispararse automáticamente hasta que el negocio demuestre que el costo mejora la decisión.
