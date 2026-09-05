<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/app-content

## Por qué existe

- **Negocio:** esta carpeta sostiene una parte mantenida del backend Atlas.
- **Sistema:** esta carpeta agrupa artefactos relacionados bajo un límite navegable.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`app-content-operations.controller.ts`](./app-content-operations.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`app-content.controller.ts`](./app-content.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`app-content.module.ts`](./app-content.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`app-content.schemas.ts`](./app-content.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`app-content.service.ts`](./app-content.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`app-content.types.ts`](./app-content.types.ts) | Tipos de dominio: hacen explícitos estados y contratos internos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
