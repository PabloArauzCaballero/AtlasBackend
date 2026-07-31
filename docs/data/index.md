# Datos

PostgreSQL 16 es la fuente de verdad: **138 tablas en 12 esquemas de dominio**, 61 migraciones
reversibles y 131 modelos Sequelize.

| Si buscas | Ve a |
|---|---|
| Cómo está organizado el modelo | [Arquitectura de datos](data-architecture.md) |
| Qué entidades existen y para qué | [Catálogo de entidades](entity-catalog.md) |
| Cómo se evoluciona el esquema | [Migraciones y seeds](migrations.md) |
| Cuánto se conserva cada dato | [Retención y clasificación](retention.md) |

## Reglas que no se negocian

- **Nunca `sync({ force })` ni `sync({ alter })`.** El esquema sólo cambia por migración.
- **Toda migración tiene `up` y `down`.** Lo verifica `yarn check:migrations`.
- **Cambios destructivos por expand/contract**: añadir de forma idempotente, backfill, y sólo entonces
  endurecer.
- **El runtime no tiene DDL.** `atlas_app_rw` para la aplicación, `atlas_migrator` para migrar.
- **PII: hash para buscar, blob cifrado para guardar.** Las columnas cifradas nunca se indexan.
