<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/business

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta business como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`actors-and-roles.md`](./actors-and-roles.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`business-context.md`](./business-context.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`business-rules.md`](./business-rules.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`critical-workflows.md`](./critical-workflows.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`glossary.md`](./glossary.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
