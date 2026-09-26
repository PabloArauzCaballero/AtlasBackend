<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/obsidian/backend/07-async-processing

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta 07-async-processing como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`events.md`](./events.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`idempotency.md`](./idempotency.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`ordering-and-concurrency.md`](./ordering-and-concurrency.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`queues.md`](./queues.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`retry-and-dead-letter.md`](./retry-and-dead-letter.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`schedulers.md`](./schedulers.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`workers.md`](./workers.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
