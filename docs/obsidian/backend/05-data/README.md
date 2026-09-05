<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/obsidian/backend/05-data

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta 05-data como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`backups-and-restore.md`](./backups-and-restore.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`conceptual-data-model.md`](./conceptual-data-model.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`data-architecture.md`](./data-architecture.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`data-dictionary.md`](./data-dictionary.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`data-stores.md`](./data-stores.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`entity-relationship-model.md`](./entity-relationship-model.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`logical-data-model.md`](./logical-data-model.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`migrations.md`](./migrations.md) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`physical-data-model.md`](./physical-data-model.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`relationship-catalog.md`](./relationship-catalog.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`retention-and-deletion.md`](./retention-and-deletion.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`schemas.md`](./schemas.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`sensitive-data.md`](./sensitive-data.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Subcarpetas

- [`domains/`](./domains/README.md)
- [`entities/`](./entities/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
