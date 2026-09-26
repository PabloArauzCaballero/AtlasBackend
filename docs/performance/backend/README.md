<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/performance/backend

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta backend como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`00-prestart-resource-hygiene.md`](./00-prestart-resource-hygiene.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`01-baseline.md`](./01-baseline.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`02-bottleneck-map.md`](./02-bottleneck-map.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`03-optimization-plan.md`](./03-optimization-plan.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`04-before-after-report.md`](./04-before-after-report.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`05-performance-budget.md`](./05-performance-budget.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`06-observability.md`](./06-observability.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`07-runbook.md`](./07-runbook.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
