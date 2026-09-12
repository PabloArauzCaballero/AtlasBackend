<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/internal-users

## Por qué existe

- **Negocio:** esta carpeta controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
- **Sistema:** esta carpeta implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`internal-access-catalog.controller.ts`](./internal-access-catalog.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`internal-access-catalog.repository.ts`](./internal-access-catalog.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`internal-access-catalog.schemas.ts`](./internal-access-catalog.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`internal-access-catalog.service.ts`](./internal-access-catalog.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`internal-access-catalog.types.ts`](./internal-access-catalog.types.ts) | Tipos de dominio: hacen explícitos estados y contratos internos. |
| [`internal-auth.controller.ts`](./internal-auth.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`internal-auth.service.ts`](./internal-auth.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`internal-permissions.decorator.ts`](./internal-permissions.decorator.ts) | Decorador: expresa metadatos o extrae contexto HTTP de forma uniforme. |
| [`internal-profile-second-factor.ts`](./internal-profile-second-factor.ts) | Artefacto de soporte específico de esta carpeta. |
| [`internal-rbac.permissions.ts`](./internal-rbac.permissions.ts) | Artefacto de soporte específico de esta carpeta. |
| [`internal-rbac.repository.ts`](./internal-rbac.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`internal-rbac.roles.ts`](./internal-rbac.roles.ts) | Artefacto de soporte específico de esta carpeta. |
| [`internal-rbac.seed-data.ts`](./internal-rbac.seed-data.ts) | Seeder idempotente: instala datos de referencia o fixtures del perfil. |
| [`internal-users.controller.ts`](./internal-users.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`internal-users.module.ts`](./internal-users.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`internal-users.schemas.ts`](./internal-users.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`internal-users.service.ts`](./internal-users.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`internal-users.types.ts`](./internal-users.types.ts) | Tipos de dominio: hacen explícitos estados y contratos internos. |

## Subcarpetas

- [`guards/`](./guards/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
