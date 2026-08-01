<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/runtime-jobs

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que completa trabajo asíncrono y recuperable fuera de la latencia del request.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; reclama, procesa y reintenta jobs/outbox con locks y métricas operativas.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`deliver-pending-notifications.spec.ts`](./deliver-pending-notifications.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`job-run-recorder.service.spec.ts`](./job-run-recorder.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`runtime-jobs-scheduler.roles.spec.ts`](./runtime-jobs-scheduler.roles.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`runtime-jobs-scheduler.service.spec.ts`](./runtime-jobs-scheduler.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`runtime-jobs.controller.spec.ts`](./runtime-jobs.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`runtime-jobs.service.spec.ts`](./runtime-jobs.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`runtime-maintenance-jobs.service.spec.ts`](./runtime-maintenance-jobs.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
