<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/workflow-catalog

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`exposed-route-scanner.service.spec.ts`](./exposed-route-scanner.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`workflow-bundle-filter.util.spec.ts`](./workflow-bundle-filter.util.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`workflow-bundle.fixtures.ts`](./workflow-bundle.fixtures.ts) | Artefacto de soporte específico de esta carpeta. |
| [`workflow-catalog.mapper.spec.ts`](./workflow-catalog.mapper.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`workflow-catalog.repository.spec.ts`](./workflow-catalog.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`workflow-catalog.service.spec.ts`](./workflow-catalog.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`workflow-completion-rule.util.spec.ts`](./workflow-completion-rule.util.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`workflow-consistency.service.spec.ts`](./workflow-consistency.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`workflow-graph.builder.spec.ts`](./workflow-graph.builder.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`workflow-progress.service.spec.ts`](./workflow-progress.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`workflow-stage-order.util.spec.ts`](./workflow-stage-order.util.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`workflow-transition.service.spec.ts`](./workflow-transition.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
