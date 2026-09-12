<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/obsidian/backend/09-observability

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta 09-observability como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`alerts.md`](./alerts.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`correlation-ids.md`](./correlation-ids.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`logging.md`](./logging.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`metrics.md`](./metrics.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`observability-overview.md`](./observability-overview.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`slo-sli-sla.md`](./slo-sli-sla.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`tracing.md`](./tracing.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
