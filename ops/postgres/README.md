<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# ops/postgres

## Por qué existe

- **Negocio:** esta carpeta hace desplegable y operable el servicio con controles reproducibles.
- **Sistema:** esta carpeta versiona configuración de base de datos y observabilidad fuera del código de aplicación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`bootstrap-roles.sql`](./bootstrap-roles.sql) | Operación PostgreSQL versionada para bootstrap o verificación. |
| [`grants.sql`](./grants.sql) | Operación PostgreSQL versionada para bootstrap o verificación. |
| [`verify-privileges.sql`](./verify-privileges.sql) | Operación PostgreSQL versionada para bootstrap o verificación. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
