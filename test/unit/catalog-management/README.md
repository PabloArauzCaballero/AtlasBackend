<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/catalog-management

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que gobierna los catálogos que convierten datos externos y reglas de riesgo en decisiones consistentes.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; implementa ingesta, versionado, aprobación, activación y consulta transaccional de catálogos.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`catalog-data-governance.repository.spec.ts`](./catalog-data-governance.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`catalog-data-governance.service.spec.ts`](./catalog-data-governance.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`catalog-definition-rows.mapper.spec.ts`](./catalog-definition-rows.mapper.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`catalog-definitions.repository.spec.ts`](./catalog-definitions.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`catalog-definitions.service.spec.ts`](./catalog-definitions.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`catalog-ingestion.service.spec.ts`](./catalog-ingestion.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`catalog-management.controller.spec.ts`](./catalog-management.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`catalog-management.mapper.spec.ts`](./catalog-management.mapper.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`catalog-management.repository.spec.ts`](./catalog-management.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`catalog-management.service.spec.ts`](./catalog-management.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`catalog-query.service.spec.ts`](./catalog-query.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`catalog-risk-policy.repository.spec.ts`](./catalog-risk-policy.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`catalog-risk-policy.service.spec.ts`](./catalog-risk-policy.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`catalog-version-workflow.service.spec.ts`](./catalog-version-workflow.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
