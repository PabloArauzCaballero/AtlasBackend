<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/notifications

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.

## Contenido

| Documento o código                                                                                     | Responsabilidad                                               |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| [`apns.util.spec.ts`](./apns.util.spec.ts)                                                             | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`brevo-callbacks.spec.ts`](./brevo-callbacks.spec.ts)                                                 | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`brevo-config-and-otp.spec.ts`](./brevo-config-and-otp.spec.ts)                                       | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`brevo-sms-credit.spec.ts`](./brevo-sms-credit.spec.ts)                                               | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`brevo.adapters.spec.ts`](./brevo.adapters.spec.ts)                                                   | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`delivery-status.repository.spec.ts`](./delivery-status.repository.spec.ts)                           | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`email.adapter.spec.ts`](./email.adapter.spec.ts)                                                     | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`erp-mail.controller.spec.ts`](./erp-mail.controller.spec.ts)                                         | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`gmail-mime.util.spec.ts`](./gmail-mime.util.spec.ts)                                                 | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`gmail.adapter.spec.ts`](./gmail.adapter.spec.ts)                                                     | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`governance-content-roles.spec.ts`](./governance-content-roles.spec.ts)                               | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`http-adapter.util.spec.ts`](./http-adapter.util.spec.ts)                                             | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`http-recipient-directory.adapter.spec.ts`](./http-recipient-directory.adapter.spec.ts)               | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`in-app-notification.adapter.spec.ts`](./in-app-notification.adapter.spec.ts)                         | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`internal-mail.controller.spec.ts`](./internal-mail.controller.spec.ts)                               | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`messaging-backfill.spec.ts`](./messaging-backfill.spec.ts)                                           | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-broadcast.deferred.spec.ts`](./notification-broadcast.deferred.spec.ts)                 | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-broadcast.repository.spec.ts`](./notification-broadcast.repository.spec.ts)             | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-broadcast.service.spec.ts`](./notification-broadcast.service.spec.ts)                   | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-deliveries.repository.spec.ts`](./notification-deliveries.repository.spec.ts)           | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-delivery-targets.util.spec.ts`](./notification-delivery-targets.util.spec.ts)           | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-device-tokens.repository.spec.ts`](./notification-device-tokens.repository.spec.ts)     | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-device-tokens.service.spec.ts`](./notification-device-tokens.service.spec.ts)           | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-dispatch.service.spec.ts`](./notification-dispatch.service.spec.ts)                     | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-event-handler.service.spec.ts`](./notification-event-handler.service.spec.ts)           | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-inbox.repository.spec.ts`](./notification-inbox.repository.spec.ts)                     | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-inbox.service.spec.ts`](./notification-inbox.service.spec.ts)                           | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-list.filters.spec.ts`](./notification-list.filters.spec.ts)                             | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-messages.repository.spec.ts`](./notification-messages.repository.spec.ts)               | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-messages.service.spec.ts`](./notification-messages.service.spec.ts)                     | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-policies-list-query.spec.ts`](./notification-policies-list-query.spec.ts)               | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-policies.repository.spec.ts`](./notification-policies.repository.spec.ts)               | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-preferences.repository.spec.ts`](./notification-preferences.repository.spec.ts)         | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-preferences.service.spec.ts`](./notification-preferences.service.spec.ts)               | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-provider-config.service.spec.ts`](./notification-provider-config.service.spec.ts)       | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-rules-producers.spec.ts`](./notification-rules-producers.spec.ts)                       | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-rules.service.spec.ts`](./notification-rules.service.spec.ts)                           | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-template-renderer.service.spec.ts`](./notification-template-renderer.service.spec.ts)   | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-templates.repository.spec.ts`](./notification-templates.repository.spec.ts)             | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notification-templates.service.spec.ts`](./notification-templates.service.spec.ts)                   | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notifications.controller.spec.ts`](./notifications.controller.spec.ts)                               | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`notifications.mapper.spec.ts`](./notifications.mapper.spec.ts)                                       | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`provider-callback-signatures.spec.ts`](./provider-callback-signatures.spec.ts)                       | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`provider-callbacks.controller.spec.ts`](./provider-callbacks.controller.spec.ts)                     | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`provider-callbacks.service.spec.ts`](./provider-callbacks.service.spec.ts)                           | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`push.adapter.spec.ts`](./push.adapter.spec.ts)                                                       | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`sequelize-device-token-registry.adapter.spec.ts`](./sequelize-device-token-registry.adapter.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`sms.adapter.spec.ts`](./sms.adapter.spec.ts)                                                         | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`twilio-request.util.spec.ts`](./twilio-request.util.spec.ts)                                         | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`twilio-sendgrid-config.spec.ts`](./twilio-sendgrid-config.spec.ts)                                   | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`whatsapp.adapter.spec.ts`](./whatsapp.adapter.spec.ts)                                               | Prueba automatizada: fija comportamiento y evita regresiones. |

## Subcarpetas

- [`campaigns/`](./campaigns/README.md)
- [`support/`](./support/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
