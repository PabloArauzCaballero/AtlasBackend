<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/loan-payment-claims

## Por qué existe

- **Negocio:** esta carpeta sostiene una parte mantenida del backend Atlas.
- **Sistema:** esta carpeta agrupa artefactos relacionados bajo un límite navegable.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`loan-payment-claims.module.ts`](./loan-payment-claims.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`loan-payment-claims.schemas.ts`](./loan-payment-claims.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`loan-payment-claims.service.ts`](./loan-payment-claims.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`merchant-payment-claims.controller.ts`](./merchant-payment-claims.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`mobile-payment-claims.controller.ts`](./mobile-payment-claims.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
