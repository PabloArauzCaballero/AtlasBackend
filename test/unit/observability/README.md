<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/observability

## Por qué existe

- **Negocio:** esta carpeta previene regresiones que afectarían los contratos críticos del backend.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; valida componentes aislados.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`http-metrics.interceptor.spec.ts`](./http-metrics.interceptor.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`metrics.controller.spec.ts`](./metrics.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`metrics.service.spec.ts`](./metrics.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`observability.config.spec.ts`](./observability.config.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`tracing.spec.ts`](./tracing.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
