<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/systems-ops

## Por qué existe

- **Negocio:** esta carpeta hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
- **Sistema:** esta carpeta descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`action-log-filter-catalog.ts`](./action-log-filter-catalog.ts) | Artefacto de soporte específico de esta carpeta. |
| [`column-classification.util.ts`](./column-classification.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`endpoint-code.util.ts`](./endpoint-code.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`endpoint-discovery.service.ts`](./endpoint-discovery.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`erp-entity-inventory.json`](./erp-entity-inventory.json) | Configuración o contrato serializado consumido por herramientas. |
| [`path-exists.util.ts`](./path-exists.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`platform-service-health.probe.ts`](./platform-service-health.probe.ts) | Artefacto de soporte específico de esta carpeta. |
| [`platform-services.constants.ts`](./platform-services.constants.ts) | Artefacto de soporte específico de esta carpeta. |
| [`systems-action-log-query.service.ts`](./systems-action-log-query.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`systems-action-log.controller.ts`](./systems-action-log.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`systems-action-log.repository.ts`](./systems-action-log.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`systems-business-metadata.fixtures.ts`](./systems-business-metadata.fixtures.ts) | Artefacto de soporte específico de esta carpeta. |
| [`systems-catalog-classifier.service.ts`](./systems-catalog-classifier.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`systems-catalog-query.service.ts`](./systems-catalog-query.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`systems-catalog-seed.service.ts`](./systems-catalog-seed.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`systems-catalog-sql.constants.ts`](./systems-catalog-sql.constants.ts) | Artefacto de soporte específico de esta carpeta. |
| [`systems-catalog.controller.ts`](./systems-catalog.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`systems-catalog.repository.ts`](./systems-catalog.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`systems-controller.decorators.ts`](./systems-controller.decorators.ts) | Artefacto de soporte específico de esta carpeta. |
| [`systems-dashboard.repository.ts`](./systems-dashboard.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`systems-data-impact-inference.repository.ts`](./systems-data-impact-inference.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`systems-data-impact-inference.service.ts`](./systems-data-impact-inference.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`systems-endpoint-docs.service.ts`](./systems-endpoint-docs.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`systems-entity-narrative.mapper.ts`](./systems-entity-narrative.mapper.ts) | Mapper: transforma modelos internos a contratos de transporte. |
| [`systems-erp-inventory.service.ts`](./systems-erp-inventory.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`systems-health-monitor.service.ts`](./systems-health-monitor.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`systems-health.service.ts`](./systems-health.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`systems-json-path.util.ts`](./systems-json-path.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`systems-ops.constants.ts`](./systems-ops.constants.ts) | Artefacto de soporte específico de esta carpeta. |
| [`systems-ops.dtos.ts`](./systems-ops.dtos.ts) | DTOs: contrato estable de salida sin filtrar modelos de persistencia. |
| [`systems-ops.mapper.ts`](./systems-ops.mapper.ts) | Mapper: transforma modelos internos a contratos de transporte. |
| [`systems-ops.module.ts`](./systems-ops.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`systems-ops.schemas.ts`](./systems-ops.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`systems-ops.tool.mapper.ts`](./systems-ops.tool.mapper.ts) | Mapper: transforma modelos internos a contratos de transporte. |
| [`systems-ops.types.ts`](./systems-ops.types.ts) | Tipos de dominio: hacen explícitos estados y contratos internos. |
| [`systems-repository-where.util.ts`](./systems-repository-where.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`systems-review.controller.ts`](./systems-review.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`systems-review.repository.ts`](./systems-review.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`systems-review.service.ts`](./systems-review.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`systems-sanitizer.ts`](./systems-sanitizer.ts) | Artefacto de soporte específico de esta carpeta. |
| [`systems-schema-introspection.service.ts`](./systems-schema-introspection.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`systems-seed-fixtures.ts`](./systems-seed-fixtures.ts) | Seeder idempotente: instala datos de referencia o fixtures del perfil. |
| [`systems-source-scan.util.ts`](./systems-source-scan.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`systems-stress-profile.repository.ts`](./systems-stress-profile.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`systems-stress-profile.service.ts`](./systems-stress-profile.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`systems-stress-run.service.ts`](./systems-stress-run.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`systems-stress.controller.ts`](./systems-stress.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`systems-tenant-scope.util.ts`](./systems-tenant-scope.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`systems-test-assertion.service.ts`](./systems-test-assertion.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`systems-test-execution.repository.ts`](./systems-test-execution.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`systems-test-http-client.service.ts`](./systems-test-http-client.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`systems-test-query.service.ts`](./systems-test-query.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`systems-test-runner.service.ts`](./systems-test-runner.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`systems-test-suite-admin.repository.ts`](./systems-test-suite-admin.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`systems-test-suite-admin.service.ts`](./systems-test-suite-admin.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`systems-test-template.service.ts`](./systems-test-template.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`systems-test-url-policy.util.ts`](./systems-test-url-policy.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`systems-test.controller.ts`](./systems-test.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`systems-tool-inference.repository.ts`](./systems-tool-inference.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`systems-tool-inference.service.ts`](./systems-tool-inference.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Subcarpetas

- [`entity-narratives/`](./entity-narratives/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
