<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/data

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta data como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`data-architecture.md`](./data-architecture.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`entity-catalog.md`](./entity-catalog.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`index.md`](./index.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`migrations.md`](./migrations.md) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`retention.md`](./retention.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
