<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/sql-console

## Por qué existe

- **Negocio:** esta carpeta sostiene una parte mantenida del backend Atlas.
- **Sistema:** esta carpeta agrupa artefactos relacionados bajo un límite navegable.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`sql-console-catalog.service.ts`](./sql-console-catalog.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`sql-console-query.service.ts`](./sql-console-query.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`sql-console.constants.ts`](./sql-console.constants.ts) | Artefacto de soporte específico de esta carpeta. |
| [`sql-console.controller.ts`](./sql-console.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`sql-console.module.ts`](./sql-console.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`sql-statement-guard.ts`](./sql-statement-guard.ts) | Artefacto de soporte específico de esta carpeta. |
| [`sql-tokenizer.ts`](./sql-tokenizer.ts) | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
