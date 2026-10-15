<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/risk/repositories

## Por qué existe

- **Negocio:** esta carpeta produce una recomendación explicable para reducir pérdida crediticia y trato inconsistente.
- **Sistema:** esta carpeta calcula evaluaciones versionadas, contribuciones y reglas disparadas sin presentarlas como un modelo validado.

## Contenido

| Documento o código                                                             | Responsabilidad                                                  |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [`revision-manual.repository.ts`](./revision-manual.repository.ts)             | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`risk-assessment.repository.ts`](./risk-assessment.repository.ts)             | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`risk-audit.repository.ts`](./risk-audit.repository.ts)                       | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`risk-customer-facts.repository.ts`](./risk-customer-facts.repository.ts)     | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`risk-feature-evidence.repository.ts`](./risk-feature-evidence.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`risk-policy.repository.ts`](./risk-policy.repository.ts)                     | Puerto de persistencia: encapsula consultas, locks y escrituras. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
