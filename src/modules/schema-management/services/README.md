<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/schema-management/services

## Por qué existe

- **Negocio:** esta carpeta gobierna propuestas de estructura sin permitir DDL directo desde el portal.
- **Sistema:** esta carpeta valida y audita el catálogo de cambios; la ejecución física permanece en migraciones revisadas.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`schema-management-validation.service.ts`](./schema-management-validation.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`schema-management.service.ts`](./schema-management.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
