<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/obsidian/backend/01-overview

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta 01-overview como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`assumptions-and-gaps.md`](./assumptions-and-gaps.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`glossary.md`](./glossary.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`project-overview.md`](./project-overview.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`repository-map.md`](./repository-map.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`technology-stack.md`](./technology-stack.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
