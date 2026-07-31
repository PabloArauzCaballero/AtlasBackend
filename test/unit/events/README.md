<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/events

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que desacopla procesos de negocio y permite reintentos auditables sin perder eventos.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; registra definiciones, outbox y procesamiento idempotente de eventos de dominio.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`events.controller.spec.ts`](./events.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`events.repository.spec.ts`](./events.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`events.service.spec.ts`](./events.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
