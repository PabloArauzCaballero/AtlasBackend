<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/runtime-jobs

## Por qué existe

- **Negocio:** esta carpeta completa trabajo asíncrono y recuperable fuera de la latencia del request.
- **Sistema:** esta carpeta reclama, procesa y reintenta jobs/outbox con locks y métricas operativas.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`job-run-recorder.service.ts`](./job-run-recorder.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`job-tick-guard.ts`](./job-tick-guard.ts) | Artefacto de soporte específico de esta carpeta. |
| [`runtime-jobs-scheduler.service.ts`](./runtime-jobs-scheduler.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`runtime-jobs.controller.ts`](./runtime-jobs.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`runtime-jobs.module.ts`](./runtime-jobs.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`runtime-jobs.schemas.ts`](./runtime-jobs.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`runtime-jobs.service.ts`](./runtime-jobs.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`runtime-maintenance-jobs.service.ts`](./runtime-maintenance-jobs.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`scheduled-jobs.catalog.ts`](./scheduled-jobs.catalog.ts) | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
