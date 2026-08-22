<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/risk/application

## Por qué existe

- **Negocio:** esta carpeta produce una recomendación explicable para reducir pérdida crediticia y trato inconsistente.
- **Sistema:** esta carpeta calcula evaluaciones versionadas, contribuciones y reglas disparadas sin presentarlas como un modelo validado.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`risk-assessment-persistence.ts`](./risk-assessment-persistence.ts) | Artefacto de soporte específico de esta carpeta. |
| [`risk-feature-evidence.ts`](./risk-feature-evidence.ts) | Artefacto de soporte específico de esta carpeta. |
| [`risk-heuristic-scoring.ts`](./risk-heuristic-scoring.ts) | Artefacto de soporte específico de esta carpeta. |
| [`risk-model-identity.ts`](./risk-model-identity.ts) | Artefacto de soporte específico de esta carpeta. |
| [`risk-policy-decision.service.ts`](./risk-policy-decision.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`risk-policy-features.ts`](./risk-policy-features.ts) | Artefacto de soporte específico de esta carpeta. |
| [`risk-rule-expression.ts`](./risk-rule-expression.ts) | Artefacto de soporte específico de esta carpeta. |
| [`risk-ruleset-evaluator.ts`](./risk-ruleset-evaluator.ts) | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
