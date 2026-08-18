<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/customers/repositories

## Por qué existe

- **Negocio:** esta carpeta mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
- **Sistema:** esta carpeta expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`customer-contacts.repository.ts`](./customer-contacts.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`customer-eligibility-risk.repository.ts`](./customer-eligibility-risk.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`customer-eligibility.facts.ts`](./customer-eligibility.facts.ts) | Artefacto de soporte específico de esta carpeta. |
| [`customer-eligibility.read-options.ts`](./customer-eligibility.read-options.ts) | Artefacto de soporte específico de esta carpeta. |
| [`customer-eligibility.repository.ts`](./customer-eligibility.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`customer-lifecycle.repository.ts`](./customer-lifecycle.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
