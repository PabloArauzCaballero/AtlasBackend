# Catálogo de eventos ATLAS

El catálogo vive en `src/modules/events/event-registry.ts`.

Familias incluidas:

- `user_security`
- `kyc_legal`
- `risk_scoring_fraud`
- `credit_line`
- `purchase_downpayment`
- `installments_collections`
- `merchant_settlement`
- `notifications`

Cada evento declara:

```ts
{
  code: string;
  family: string;
  version: number;
  description: string;
  defaultPriority: number;
  allowedAggregateTypes: string[];
}
```

Los eventos desconocidos se rechazan para evitar que cada módulo invente nombres incompatibles.
