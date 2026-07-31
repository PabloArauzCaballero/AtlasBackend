<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/systems-ops

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`systems-action-log-query.service.spec.ts`](./systems-action-log-query.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-action-log.controller.spec.ts`](./systems-action-log.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-action-log.repository.spec.ts`](./systems-action-log.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-catalog-query.service.spec.ts`](./systems-catalog-query.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-catalog.controller.spec.ts`](./systems-catalog.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-catalog.repository.spec.ts`](./systems-catalog.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-dashboard.repository.spec.ts`](./systems-dashboard.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-data-impact-inference.repository.spec.ts`](./systems-data-impact-inference.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-data-impact-inference.service.spec.ts`](./systems-data-impact-inference.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-health-monitor.service.spec.ts`](./systems-health-monitor.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-health.service.spec.ts`](./systems-health.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-repository-where.util.spec.ts`](./systems-repository-where.util.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-review.controller.spec.ts`](./systems-review.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-review.repository.spec.ts`](./systems-review.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-review.service.spec.ts`](./systems-review.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-stress-profile.repository.spec.ts`](./systems-stress-profile.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-stress-profile.service.spec.ts`](./systems-stress-profile.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-stress-run.service.spec.ts`](./systems-stress-run.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-stress.controller.spec.ts`](./systems-stress.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-test-assertion.service.spec.ts`](./systems-test-assertion.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-test-execution.repository.spec.ts`](./systems-test-execution.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-test-http-client.service.spec.ts`](./systems-test-http-client.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-test-query.service.spec.ts`](./systems-test-query.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-test-runner.service.spec.ts`](./systems-test-runner.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-test-suite-admin.repository.spec.ts`](./systems-test-suite-admin.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-test-suite-admin.service.spec.ts`](./systems-test-suite-admin.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-test-template.service.spec.ts`](./systems-test-template.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-test-url-policy.util.spec.ts`](./systems-test-url-policy.util.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-test.controller.spec.ts`](./systems-test.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-tool-inference.repository.spec.ts`](./systems-tool-inference.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-tool-inference.service.spec.ts`](./systems-tool-inference.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
