<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/audit

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que aporta trazabilidad verificable de acciones y cambios para investigación, cumplimiento y soporte.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; consolida consultas y persistencia de eventos de auditoría sin exponer modelos ORM al transporte.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`audit-cursor.spec.ts`](./audit-cursor.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`audit-repository-event-types.spec.ts`](./audit-repository-event-types.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`audit.controller.spec.ts`](./audit.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`audit.repository.spec.ts`](./audit.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`audit.service.spec.ts`](./audit.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`http-action-log.service.spec.ts`](./http-action-log.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`system-action-log-row.mapper.spec.ts`](./system-action-log-row.mapper.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
