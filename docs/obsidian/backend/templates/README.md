<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/obsidian/backend/templates

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta templates como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`adr-template.md`](./adr-template.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`data-entity-template.md`](./data-entity-template.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`endpoint-template.md`](./endpoint-template.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`index.md`](./index.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`integration-template.md`](./integration-template.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`module-template.md`](./module-template.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`runbook-template.md`](./runbook-template.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
