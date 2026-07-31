<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/customer-telemetry

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que captura señales de comportamiento y dispositivo necesarias para prevención de fraude y mejora de conversión.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; valida e ingiere lotes de telemetría con límites, redacción y escritura transaccional.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`customer-telemetry.controller.spec.ts`](./customer-telemetry.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-telemetry.repository.spec.ts`](./customer-telemetry.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-telemetry.service.spec.ts`](./customer-telemetry.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
