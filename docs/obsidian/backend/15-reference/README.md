<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/obsidian/backend/15-reference

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta 15-reference como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`commands.md`](./commands.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`endpoint-catalog.md`](./endpoint-catalog.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`entity-catalog.md`](./entity-catalog.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`environment-variables.md`](./environment-variables.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`error-catalog.md`](./error-catalog.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`events-catalog.md`](./events-catalog.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`index.md`](./index.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`permissions-matrix.md`](./permissions-matrix.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`ports.md`](./ports.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`source-index.md`](./source-index.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`status-codes.md`](./status-codes.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
