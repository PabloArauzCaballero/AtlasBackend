<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/auth

## Por qué existe

- **Negocio:** esta carpeta protege el acceso de clientes y operadores, la recuperación de cuenta y la continuidad segura de sesiones.
- **Sistema:** esta carpeta resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`auth-actor-resolver.service.ts`](./auth-actor-resolver.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`auth-one-time-code.repository.ts`](./auth-one-time-code.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`auth-password-reset.service.ts`](./auth-password-reset.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`auth-second-factor.service.ts`](./auth-second-factor.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`auth-token-issuer.service.ts`](./auth-token-issuer.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`auth.controller.ts`](./auth.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`auth.dtos.ts`](./auth.dtos.ts) | DTOs: contrato estable de salida sin filtrar modelos de persistencia. |
| [`auth.module.ts`](./auth.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`auth.repository.ts`](./auth.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`auth.schemas.ts`](./auth.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`auth.service.ts`](./auth.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`merchant-actor.repository.ts`](./merchant-actor.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
