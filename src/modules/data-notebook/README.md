<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/data-notebook

## Por qué existe

- **Negocio:** esta carpeta sostiene una parte mantenida del backend Atlas.
- **Sistema:** esta carpeta agrupa artefactos relacionados bajo un límite navegable.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`data-notebook-catalog.service.ts`](./data-notebook-catalog.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`data-notebook-dataset.service.ts`](./data-notebook-dataset.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`data-notebook-document.service.ts`](./data-notebook-document.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`data-notebook-history.service.ts`](./data-notebook-history.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`data-notebook-masking.ts`](./data-notebook-masking.ts) | Artefacto de soporte específico de esta carpeta. |
| [`data-notebook-size.ts`](./data-notebook-size.ts) | Artefacto de soporte específico de esta carpeta. |
| [`data-notebook.constants.ts`](./data-notebook.constants.ts) | Artefacto de soporte específico de esta carpeta. |
| [`data-notebook.controller.ts`](./data-notebook.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`data-notebook.module.ts`](./data-notebook.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`data-notebook.schemas.ts`](./data-notebook.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
