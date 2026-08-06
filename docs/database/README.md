<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/database

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta database como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`data-model-plan-status.md`](./data-model-plan-status.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`dev-credentials.md`](./dev-credentials.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`domain-schemas.md`](./domain-schemas.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`migrations.md`](./migrations.md) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`postgres-error-mapping.md`](./postgres-error-mapping.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`postgres-roles.md`](./postgres-roles.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`query-baseline.md`](./query-baseline.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`read-models.md`](./read-models.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`read-workload-inventory.md`](./read-workload-inventory.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`seeds.md`](./seeds.md) | Seeder idempotente: instala datos de referencia o fixtures del perfil. |
| [`view-candidates.md`](./view-candidates.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
