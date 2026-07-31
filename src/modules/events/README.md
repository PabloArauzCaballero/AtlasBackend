<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/events

## Por qué existe

- **Negocio:** esta carpeta desacopla procesos de negocio y permite reintentos auditables sin perder eventos.
- **Sistema:** esta carpeta registra definiciones, outbox y procesamiento idempotente de eventos de dominio.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`event-registry.ts`](./event-registry.ts) | Artefacto de soporte específico de esta carpeta. |
| [`event-types.ts`](./event-types.ts) | Artefacto de soporte específico de esta carpeta. |
| [`events.controller.ts`](./events.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`events.module.ts`](./events.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`events.repository.ts`](./events.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`events.schemas.ts`](./events.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`events.service.ts`](./events.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
