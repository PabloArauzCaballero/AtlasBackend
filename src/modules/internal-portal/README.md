<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/internal-portal

## Por qué existe

- **Negocio:** esta carpeta ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
- **Sistema:** esta carpeta compone consultas read-only, reportes, glosario, linaje y búsqueda para el portal administrativo.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`admin-read.controller.ts`](./admin-read.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`admin-read.schemas.ts`](./admin-read.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`business-metadata.openapi.ts`](./business-metadata.openapi.ts) | Artefacto de soporte específico de esta carpeta. |
| [`internal-portal.controller.ts`](./internal-portal.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`internal-portal.module.ts`](./internal-portal.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`internal-portal.schemas.ts`](./internal-portal.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`internal-portal.service.ts`](./internal-portal.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Subcarpetas

- [`application/`](./application/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
