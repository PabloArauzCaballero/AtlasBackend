<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/notifications

## Por qué existe

- **Negocio:** esta carpeta entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
- **Sistema:** esta carpeta orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`notification-broadcast.service.ts`](./notification-broadcast.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`notification-delivery-targets.util.ts`](./notification-delivery-targets.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`notification-orchestrator.service.ts`](./notification-orchestrator.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`notification-policies-operations.controller.ts`](./notification-policies-operations.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`notification-policies.repository.ts`](./notification-policies.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`notification-preferences.repository.ts`](./notification-preferences.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`notification-rules.service.ts`](./notification-rules.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`notification-template-renderer.service.ts`](./notification-template-renderer.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`notification-templates.repository.ts`](./notification-templates.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`notification-types.ts`](./notification-types.ts) | Artefacto de soporte específico de esta carpeta. |
| [`notifications.controller.ts`](./notifications.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`notifications.mapper.ts`](./notifications.mapper.ts) | Mapper: transforma modelos internos a contratos de transporte. |
| [`notifications.module.ts`](./notifications.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`notifications.repository.ts`](./notifications.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`notifications.schemas.ts`](./notifications.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`notifications.service.ts`](./notifications.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Subcarpetas

- [`adapters/`](./adapters/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
