<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/resilience

## Por qué existe

- **Negocio:** esta carpeta previene regresiones que afectarían los contratos críticos del backend.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; valida componentes aislados.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`adapter-error.spec.ts`](./adapter-error.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`circuit-breaker.spec.ts`](./circuit-breaker.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`provider-config-validator.spec.ts`](./provider-config-validator.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`resilient-adapter-executor.service.spec.ts`](./resilient-adapter-executor.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`retry.util.spec.ts`](./retry.util.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
