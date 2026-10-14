<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/risk/application/ports

## Por qué existe

- **Negocio:** esta carpeta produce una recomendación explicable para reducir pérdida crediticia y trato inconsistente.
- **Sistema:** esta carpeta calcula evaluaciones versionadas, contribuciones y reglas disparadas sin presentarlas como un modelo validado.

## Contenido

| Documento o código                                                 | Responsabilidad                                  |
| ------------------------------------------------------------------ | ------------------------------------------------ |
| [`risk-assessment-store.port.ts`](./risk-assessment-store.port.ts) | Artefacto de soporte específico de esta carpeta. |
| [`risk-input-facts.port.ts`](./risk-input-facts.port.ts)           | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
