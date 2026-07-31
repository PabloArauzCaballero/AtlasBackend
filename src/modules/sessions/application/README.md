<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/sessions/application

## Por qué existe

- **Negocio:** esta carpeta mantiene continuidad, seguridad y señales de uso durante la interacción del cliente.
- **Sistema:** esta carpeta orquesta inicio, heartbeat, cierre, ubicación, dispositivo y auditoría del ciclo de sesión.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`session-end.service.ts`](./session-end.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`session-gps-writer.service.ts`](./session-gps-writer.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`session-heartbeat.service.ts`](./session-heartbeat.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`session-query.service.ts`](./session-query.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`session-start.service.ts`](./session-start.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`sessions.shared.ts`](./sessions.shared.ts) | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
