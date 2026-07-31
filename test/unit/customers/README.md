<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/customers

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`customer-eligibility-decision.service.spec.ts`](./customer-eligibility-decision.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-eligibility.evaluator.spec.ts`](./customer-eligibility.evaluator.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-eligibility.repository.spec.ts`](./customer-eligibility.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-eligibility.service.spec.ts`](./customer-eligibility.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customer-lifecycle.service.spec.ts`](./customer-lifecycle.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customers-repository-active-ids.spec.ts`](./customers-repository-active-ids.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customers.controller.spec.ts`](./customers.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customers.mapper.spec.ts`](./customers.mapper.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customers.repository.spec.ts`](./customers.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`customers.service.spec.ts`](./customers.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
