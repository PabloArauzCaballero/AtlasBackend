<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/obsidian/backend/02-architecture/adr

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta adr como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`0001-outbox-en-postgresql.md`](./0001-outbox-en-postgresql.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`0002-redis-solo-en-produccion.md`](./0002-redis-solo-en-produccion.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`0003-mongo-log-sync.md`](./0003-mongo-log-sync.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`0004-kms-envelope-encryption.md`](./0004-kms-envelope-encryption.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`0005-paginacion-por-cursor.md`](./0005-paginacion-por-cursor.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`0006-separacion-de-roles-api-worker.md`](./0006-separacion-de-roles-api-worker.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`0007-contrato-openapi-enriquecido.md`](./0007-contrato-openapi-enriquecido.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`index.md`](./index.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
