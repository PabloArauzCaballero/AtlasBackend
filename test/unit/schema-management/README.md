<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/schema-management

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que gobierna propuestas de estructura sin permitir DDL directo desde el portal.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; valida y audita el catálogo de cambios; la ejecución física permanece en migraciones revisadas.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`schema-management-validation.service.spec.ts`](./schema-management-validation.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`schema-management.controller.spec.ts`](./schema-management.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`schema-management.repository.spec.ts`](./schema-management.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`schema-management.schemas.spec.ts`](./schema-management.schemas.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`schema-management.service.spec.ts`](./schema-management.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
