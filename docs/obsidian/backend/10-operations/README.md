<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/obsidian/backend/10-operations

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta 10-operations como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`configuration.md`](./configuration.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`deployment.md`](./deployment.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`disaster-recovery.md`](./disaster-recovery.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`environments.md`](./environments.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`rollback.md`](./rollback.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`scaling.md`](./scaling.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`startup-shutdown.md`](./startup-shutdown.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Subcarpetas

- [`runbooks/`](./runbooks/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
