<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/customers/application

## Por qué existe

- **Negocio:** esta carpeta mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
- **Sistema:** esta carpeta expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`customer-eligibility-decision.service.ts`](./customer-eligibility-decision.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`customer-eligibility.evaluator.ts`](./customer-eligibility.evaluator.ts) | Artefacto de soporte específico de esta carpeta. |
| [`customer-eligibility.service.ts`](./customer-eligibility.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`customer-lifecycle.service.ts`](./customer-lifecycle.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
