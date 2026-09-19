<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/loans/domain

## Por qué existe

- **Negocio:** esta carpeta sostiene una parte mantenida del backend Atlas.
- **Sistema:** esta carpeta agrupa artefactos relacionados bajo un límite navegable.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`loan-allocation.ts`](./loan-allocation.ts) | Artefacto de soporte específico de esta carpeta. |
| [`loan-delinquency.ts`](./loan-delinquency.ts) | Artefacto de soporte específico de esta carpeta. |
| [`loan-outcome.ts`](./loan-outcome.ts) | Artefacto de soporte específico de esta carpeta. |
| [`loan-schedule.ts`](./loan-schedule.ts) | Artefacto de soporte específico de esta carpeta. |
| [`money.util.ts`](./money.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
