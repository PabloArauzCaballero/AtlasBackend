<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/risk

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que produce una recomendación explicable para reducir pérdida crediticia y trato inconsistente.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; calcula evaluaciones versionadas, contribuciones y reglas disparadas sin presentarlas como un modelo validado.

## Contenido

| Documento o código                                                                           | Responsabilidad                                               |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [`local-risk-fraud-facts.reader.spec.ts`](./local-risk-fraud-facts.reader.spec.ts)           | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`revision-manual.repository.spec.ts`](./revision-manual.repository.spec.ts)                 | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`risk-assessment.repository.spec.ts`](./risk-assessment.repository.spec.ts)                 | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`risk-audit.repository.spec.ts`](./risk-audit.repository.spec.ts)                           | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`risk-customer-facts.repository.spec.ts`](./risk-customer-facts.repository.spec.ts)         | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`risk-engine-provenance.spec.ts`](./risk-engine-provenance.spec.ts)                         | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`risk-feature-evidence.repository.spec.ts`](./risk-feature-evidence.repository.spec.ts)     | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`risk-fraud-flags.spec.ts`](./risk-fraud-flags.spec.ts)                                     | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`risk-heuristic-fallback.spec.ts`](./risk-heuristic-fallback.spec.ts)                       | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`risk-heuristic-scoring.spec.ts`](./risk-heuristic-scoring.spec.ts)                         | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`risk-manual-review-outcome.service.spec.ts`](./risk-manual-review-outcome.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`risk-model-identity.spec.ts`](./risk-model-identity.spec.ts)                               | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`risk-policy-decision.service.spec.ts`](./risk-policy-decision.service.spec.ts)             | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`risk-policy.repository.spec.ts`](./risk-policy.repository.spec.ts)                         | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`risk-ruleset-evaluator.spec.ts`](./risk-ruleset-evaluator.spec.ts)                         | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`risk.controller.spec.ts`](./risk.controller.spec.ts)                                       | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`risk.mapper.spec.ts`](./risk.mapper.spec.ts)                                               | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`risk.service.spec.ts`](./risk.service.spec.ts)                                             | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
