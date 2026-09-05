<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/database

## Por qué existe

- **Negocio:** esta carpeta preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
- **Sistema:** esta carpeta define database para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`credit-rating-models.ts`](./credit-rating-models.ts) | Artefacto de soporte específico de esta carpeta. |
| [`database-models.ts`](./database-models.ts) | Artefacto de soporte específico de esta carpeta. |
| [`domain-schemas.ts`](./domain-schemas.ts) | Artefacto de soporte específico de esta carpeta. |
| [`loan-book-models.ts`](./loan-book-models.ts) | Artefacto de soporte específico de esta carpeta. |
| [`migrate.ts`](./migrate.ts) | Artefacto de soporte específico de esta carpeta. |
| [`partner-models.ts`](./partner-models.ts) | Artefacto de soporte específico de esta carpeta. |
| [`provisioning-guard.ts`](./provisioning-guard.ts) | Artefacto de soporte específico de esta carpeta. |
| [`read-database.module.ts`](./read-database.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`seed-local-identities.ts`](./seed-local-identities.ts) | Seeder idempotente: instala datos de referencia o fixtures del perfil. |
| [`seed-source.ts`](./seed-source.ts) | Seeder idempotente: instala datos de referencia o fixtures del perfil. |
| [`seed-sync.ts`](./seed-sync.ts) | Seeder idempotente: instala datos de referencia o fixtures del perfil. |
| [`seed.ts`](./seed.ts) | Seeder idempotente: instala datos de referencia o fixtures del perfil. |
| [`sequelize.module.ts`](./sequelize.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`sequelize.ts`](./sequelize.ts) | Artefacto de soporte específico de esta carpeta. |
| [`startup-seed.service.ts`](./startup-seed.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`support-models.ts`](./support-models.ts) | Artefacto de soporte específico de esta carpeta. |

## Subcarpetas

- [`context-seed/`](./context-seed/README.md)
- [`metadata/`](./metadata/README.md)
- [`migration-support/`](./migration-support/README.md)
- [`migrations/`](./migrations/README.md)
- [`models/`](./models/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
