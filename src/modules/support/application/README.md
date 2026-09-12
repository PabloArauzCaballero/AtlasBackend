<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/support/application

## Por qué existe

- **Negocio:** esta carpeta sostiene una parte mantenida del backend Atlas.
- **Sistema:** esta carpeta agrupa artefactos relacionados bajo un límite navegable.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`support-actor.service.ts`](./support-actor.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`support-attachment.service.ts`](./support-attachment.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`support-audit.service.ts`](./support-audit.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`support-case-closure.service.ts`](./support-case-closure.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`support-case-customer.service.ts`](./support-case-customer.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`support-case-escalation.service.ts`](./support-case-escalation.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`support-case-factory.service.ts`](./support-case-factory.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`support-case-membership.service.ts`](./support-case-membership.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`support-case-read.service.ts`](./support-case-read.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`support-case-transition.service.ts`](./support-case-transition.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`support-case-workflow.service.ts`](./support-case-workflow.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`support-case.service.ts`](./support-case.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`support-channel.service.ts`](./support-channel.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`support-conversation.service.ts`](./support-conversation.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`support-desk.service.ts`](./support-desk.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`support-knowledge.service.ts`](./support-knowledge.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`support-message.service.ts`](./support-message.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`support-realtime.service.ts`](./support-realtime.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`support-sla.service.ts`](./support-sla.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
