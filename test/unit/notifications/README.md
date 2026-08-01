<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/notifications

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`email.adapter.spec.ts`](./email.adapter.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`in-app-notification.adapter.spec.ts`](./in-app-notification.adapter.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-broadcast.deferred.spec.ts`](./notification-broadcast.deferred.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-broadcast.service.spec.ts`](./notification-broadcast.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-orchestrator.service.spec.ts`](./notification-orchestrator.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-preferences.repository.spec.ts`](./notification-preferences.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-provider-config.service.spec.ts`](./notification-provider-config.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-rules.service.spec.ts`](./notification-rules.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-template-renderer.service.spec.ts`](./notification-template-renderer.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-templates.repository.spec.ts`](./notification-templates.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notifications-repository-recipient.spec.ts`](./notifications-repository-recipient.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notifications.controller.spec.ts`](./notifications.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notifications.mapper.spec.ts`](./notifications.mapper.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notifications.repository.spec.ts`](./notifications.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notifications.service.spec.ts`](./notifications.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`push.adapter.spec.ts`](./push.adapter.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`sms.adapter.spec.ts`](./sms.adapter.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`whatsapp.adapter.spec.ts`](./whatsapp.adapter.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
