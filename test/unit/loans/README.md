<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/loans

## Por qué existe

- **Negocio:** esta carpeta previene regresiones que afectarían los contratos críticos del backend.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; valida componentes aislados.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`loan-allocation.spec.ts`](./loan-allocation.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`loan-outcome.spec.ts`](./loan-outcome.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`loan-schedule.spec.ts`](./loan-schedule.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
