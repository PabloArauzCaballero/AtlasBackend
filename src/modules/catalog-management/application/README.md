<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/catalog-management/application

## Por qué existe

- **Negocio:** esta carpeta gobierna los catálogos que convierten datos externos y reglas de riesgo en decisiones consistentes.
- **Sistema:** esta carpeta implementa ingesta, versionado, aprobación, activación y consulta transaccional de catálogos.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`catalog-data-governance.service.ts`](./catalog-data-governance.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`catalog-definition-rows.mapper.ts`](./catalog-definition-rows.mapper.ts) | Mapper: transforma modelos internos a contratos de transporte. |
| [`catalog-definitions.service.ts`](./catalog-definitions.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`catalog-ingestion.service.ts`](./catalog-ingestion.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`catalog-management.shared.ts`](./catalog-management.shared.ts) | Artefacto de soporte específico de esta carpeta. |
| [`catalog-query.service.ts`](./catalog-query.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`catalog-risk-policy.service.ts`](./catalog-risk-policy.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`catalog-version-workflow.service.ts`](./catalog-version-workflow.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
