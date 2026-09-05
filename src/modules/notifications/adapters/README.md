<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/notifications/adapters

## Por qué existe

- **Negocio:** esta carpeta entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
- **Sistema:** esta carpeta orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`email.adapter.ts`](./email.adapter.ts) | Artefacto de soporte específico de esta carpeta. |
| [`http-adapter.util.ts`](./http-adapter.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`in-app-notification.adapter.ts`](./in-app-notification.adapter.ts) | Artefacto de soporte específico de esta carpeta. |
| [`notification-channel-adapter.ts`](./notification-channel-adapter.ts) | Artefacto de soporte específico de esta carpeta. |
| [`notification-provider-config.service.ts`](./notification-provider-config.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`push.adapter.ts`](./push.adapter.ts) | Artefacto de soporte específico de esta carpeta. |
| [`sms.adapter.ts`](./sms.adapter.ts) | Artefacto de soporte específico de esta carpeta. |
| [`whatsapp.adapter.ts`](./whatsapp.adapter.ts) | Artefacto de soporte específico de esta carpeta. |

## Subcarpetas

- [`gmail/`](./gmail/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
