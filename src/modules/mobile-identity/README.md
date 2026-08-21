<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/mobile-identity

## Por qué existe

- **Negocio:** esta carpeta sostiene una parte mantenida del backend Atlas.
- **Sistema:** esta carpeta agrupa artefactos relacionados bajo un límite navegable.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`mobile-identity.controller.ts`](./mobile-identity.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`mobile-identity.module.ts`](./mobile-identity.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`mobile-identity.repository.ts`](./mobile-identity.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`mobile-identity.schemas.ts`](./mobile-identity.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`mobile-identity.service.ts`](./mobile-identity.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
