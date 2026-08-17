<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/mail-sender

## Por qué existe

- **Negocio:** esta carpeta entrega comunicaciones transaccionales indispensables para verificación y recuperación de acceso.
- **Sistema:** esta carpeta encapsula el cliente HTTP de correo y sus plantillas, timeouts y errores tipados.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`gmail-mail.transport.ts`](./gmail-mail.transport.ts) | Artefacto de soporte específico de esta carpeta. |
| [`mail-sender.client.ts`](./mail-sender.client.ts) | Artefacto de soporte específico de esta carpeta. |
| [`mail-sender.module.ts`](./mail-sender.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`mail-sender.service.ts`](./mail-sender.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`mail-sender.templates.ts`](./mail-sender.templates.ts) | Artefacto de soporte específico de esta carpeta. |
| [`mail-template-render.ts`](./mail-template-render.ts) | Artefacto de soporte específico de esta carpeta. |
| [`webhook-mail.transport.ts`](./webhook-mail.transport.ts) | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
