<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/obsidian/backend/02-architecture/views

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta views como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`c4-component.md`](./c4-component.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`c4-container.md`](./c4-container.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`c4-context.md`](./c4-context.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
