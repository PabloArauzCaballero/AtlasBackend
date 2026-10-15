<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/notifications

## Por qué existe

- **Negocio:** esta carpeta entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
- **Sistema:** esta carpeta orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.

## Contenido

| Documento o código                                                                                   | Responsabilidad                                                                |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`customer-notifications.controller.ts`](./customer-notifications.controller.ts)                     | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`erp-mail.controller.ts`](./erp-mail.controller.ts)                                                 | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`internal-mail.controller.ts`](./internal-mail.controller.ts)                                       | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`internal-mail.schemas.ts`](./internal-mail.schemas.ts)                                             | Esquemas Zod: validan entradas y parámetros en el borde del sistema.           |
| [`internal-mail.sender.ts`](./internal-mail.sender.ts)                                               | Artefacto de soporte específico de esta carpeta.                               |
| [`notification-access.util.ts`](./notification-access.util.ts)                                       | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`notification-broadcast.controller.ts`](./notification-broadcast.controller.ts)                     | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`notification-broadcast.repository.ts`](./notification-broadcast.repository.ts)                     | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`notification-broadcast.service.ts`](./notification-broadcast.service.ts)                           | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`notification-channel-registry.service.ts`](./notification-channel-registry.service.ts)             | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`notification-deliveries.repository.ts`](./notification-deliveries.repository.ts)                   | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`notification-delivery-payload.builder.ts`](./notification-delivery-payload.builder.ts)             | Artefacto de soporte específico de esta carpeta.                               |
| [`notification-delivery-status.repository.ts`](./notification-delivery-status.repository.ts)         | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`notification-delivery-targets.util.ts`](./notification-delivery-targets.util.ts)                   | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`notification-device-tokens.repository.ts`](./notification-device-tokens.repository.ts)             | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`notification-device-tokens.service.ts`](./notification-device-tokens.service.ts)                   | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`notification-dispatch.service.ts`](./notification-dispatch.service.ts)                             | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`notification-event-content.util.ts`](./notification-event-content.util.ts)                         | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`notification-event-handler.service.ts`](./notification-event-handler.service.ts)                   | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`notification-inbox.repository.ts`](./notification-inbox.repository.ts)                             | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`notification-inbox.service.ts`](./notification-inbox.service.ts)                                   | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`notification-list.filters.ts`](./notification-list.filters.ts)                                     | Artefacto de soporte específico de esta carpeta.                               |
| [`notification-messages.repository.ts`](./notification-messages.repository.ts)                       | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`notification-messages.service.ts`](./notification-messages.service.ts)                             | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`notification-pagination.util.ts`](./notification-pagination.util.ts)                               | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`notification-policies-operations.controller.ts`](./notification-policies-operations.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`notification-policies.repository.ts`](./notification-policies.repository.ts)                       | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`notification-preferences.repository.ts`](./notification-preferences.repository.ts)                 | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`notification-preferences.service.ts`](./notification-preferences.service.ts)                       | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`notification-provider-callbacks.controller.ts`](./notification-provider-callbacks.controller.ts)   | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`notification-provider-callbacks.service.ts`](./notification-provider-callbacks.service.ts)         | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`notification-rules.service.ts`](./notification-rules.service.ts)                                   | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`notification-template-renderer.service.ts`](./notification-template-renderer.service.ts)           | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`notification-templates.controller.ts`](./notification-templates.controller.ts)                     | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`notification-templates.repository.ts`](./notification-templates.repository.ts)                     | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`notification-templates.service.ts`](./notification-templates.service.ts)                           | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`notification-types.ts`](./notification-types.ts)                                                   | Artefacto de soporte específico de esta carpeta.                               |
| [`notifications.controller.ts`](./notifications.controller.ts)                                       | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`notifications.mapper.ts`](./notifications.mapper.ts)                                               | Mapper: transforma modelos internos a contratos de transporte.                 |
| [`notifications.module.ts`](./notifications.module.ts)                                               | Módulo NestJS: declara el límite de inyección y sus dependencias.              |
| [`notifications.schemas.ts`](./notifications.schemas.ts)                                             | Esquemas Zod: validan entradas y parámetros en el borde del sistema.           |
| [`otp-message.util.ts`](./otp-message.util.ts)                                                       | Utilidad pura o acotada reutilizable dentro de su capa.                        |

## Subcarpetas

- [`adapters/`](./adapters/README.md)
- [`application/`](./application/README.md)
- [`campaigns/`](./campaigns/README.md)
- [`infrastructure/`](./infrastructure/README.md)
- [`public/`](./public/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
