<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/sessions

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que mantiene continuidad, seguridad y señales de uso durante la interacción del cliente.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; orquesta inicio, heartbeat, cierre, ubicación, dispositivo y auditoría del ciclo de sesión.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`session-end.service.spec.ts`](./session-end.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`session-gps-writer.service.spec.ts`](./session-gps-writer.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`session-heartbeat.service.spec.ts`](./session-heartbeat.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`session-query.service.spec.ts`](./session-query.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`session-start.service.spec.ts`](./session-start.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`sessions-activity-audit.repository.spec.ts`](./sessions-activity-audit.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`sessions-device.repository.spec.ts`](./sessions-device.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`sessions-lifecycle.repository.spec.ts`](./sessions-lifecycle.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`sessions-location.repository.spec.ts`](./sessions-location.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`sessions-onboarding-link.repository.spec.ts`](./sessions-onboarding-link.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`sessions-repository-facade.spec.ts`](./sessions-repository-facade.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`sessions-telemetry.repository.spec.ts`](./sessions-telemetry.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`sessions.controller.spec.ts`](./sessions.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`sessions.mapper.spec.ts`](./sessions.mapper.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
