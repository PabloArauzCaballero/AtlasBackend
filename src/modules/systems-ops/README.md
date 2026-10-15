<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/systems-ops

## Por qué existe

- **Negocio:** esta carpeta hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
- **Sistema:** esta carpeta descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.

## Contenido

| Documento o código                                                                             | Responsabilidad                                                                |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`action-log-filter-catalog.ts`](./action-log-filter-catalog.ts)                               | Artefacto de soporte específico de esta carpeta.                               |
| [`catalog-visibility.util.ts`](./catalog-visibility.util.ts)                                   | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`column-classification.util.ts`](./column-classification.util.ts)                             | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`decision-engine-artifacts.service.ts`](./decision-engine-artifacts.service.ts)               | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`decision-engine-artifacts.types.ts`](./decision-engine-artifacts.types.ts)                   | Tipos de dominio: hacen explícitos estados y contratos internos.               |
| [`endpoint-code.util.ts`](./endpoint-code.util.ts)                                             | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`endpoint-discovery.service.ts`](./endpoint-discovery.service.ts)                             | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`endpoint-narrative.util.ts`](./endpoint-narrative.util.ts)                                   | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`endpoint-roles.util.ts`](./endpoint-roles.util.ts)                                           | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`erp-entity-inventory.json`](./erp-entity-inventory.json)                                     | Configuración o contrato serializado consumido por herramientas.               |
| [`openapi-catalog.service.ts`](./openapi-catalog.service.ts)                                   | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`openapi-contract.util.ts`](./openapi-contract.util.ts)                                       | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`openapi-document.registry.ts`](./openapi-document.registry.ts)                               | Artefacto de soporte específico de esta carpeta.                               |
| [`path-exists.util.ts`](./path-exists.util.ts)                                                 | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`platform-blocks.constants.ts`](./platform-blocks.constants.ts)                               | Artefacto de soporte específico de esta carpeta.                               |
| [`platform-catalog-federation.client.ts`](./platform-catalog-federation.client.ts)             | Artefacto de soporte específico de esta carpeta.                               |
| [`platform-catalog-federation.repository.ts`](./platform-catalog-federation.repository.ts)     | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`platform-catalog-federation.service.ts`](./platform-catalog-federation.service.ts)           | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`platform-catalog-manifest.types.ts`](./platform-catalog-manifest.types.ts)                   | Tipos de dominio: hacen explícitos estados y contratos internos.               |
| [`platform-service-health.probe.ts`](./platform-service-health.probe.ts)                       | Artefacto de soporte específico de esta carpeta.                               |
| [`platform-services.constants.ts`](./platform-services.constants.ts)                           | Artefacto de soporte específico de esta carpeta.                               |
| [`system-data-entity-catalog.repository.ts`](./system-data-entity-catalog.repository.ts)       | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`system-data-structure.repository.ts`](./system-data-structure.repository.ts)                 | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`system-endpoint-catalog.repository.ts`](./system-endpoint-catalog.repository.ts)             | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`system-endpoint-impact.repository.ts`](./system-endpoint-impact.repository.ts)               | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`system-flows-review.controller.ts`](./system-flows-review.controller.ts)                     | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`system-flows.async.repository.ts`](./system-flows.async.repository.ts)                       | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`system-flows.async.service.ts`](./system-flows.async.service.ts)                             | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`system-flows.controller.ts`](./system-flows.controller.ts)                                   | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`system-flows.evidence.ts`](./system-flows.evidence.ts)                                       | Artefacto de soporte específico de esta carpeta.                               |
| [`system-flows.freshness.repository.ts`](./system-flows.freshness.repository.ts)               | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`system-flows.gate.repository.ts`](./system-flows.gate.repository.ts)                         | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`system-flows.gate.service.ts`](./system-flows.gate.service.ts)                               | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`system-flows.graph.events.ts`](./system-flows.graph.events.ts)                               | Artefacto de soporte específico de esta carpeta.                               |
| [`system-flows.graph.types.ts`](./system-flows.graph.types.ts)                                 | Tipos de dominio: hacen explícitos estados y contratos internos.               |
| [`system-flows.graph.util.ts`](./system-flows.graph.util.ts)                                   | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`system-flows.import.service.ts`](./system-flows.import.service.ts)                           | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`system-flows.imports.repository.ts`](./system-flows.imports.repository.ts)                   | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`system-flows.list-query.docs.ts`](./system-flows.list-query.docs.ts)                         | Artefacto de soporte específico de esta carpeta.                               |
| [`system-flows.list-query.ts`](./system-flows.list-query.ts)                                   | Artefacto de soporte específico de esta carpeta.                               |
| [`system-flows.mapper.ts`](./system-flows.mapper.ts)                                           | Mapper: transforma modelos internos a contratos de transporte.                 |
| [`system-flows.rbac-drift.ts`](./system-flows.rbac-drift.ts)                                   | Artefacto de soporte específico de esta carpeta.                               |
| [`system-flows.repository.ts`](./system-flows.repository.ts)                                   | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`system-flows.review.repository.ts`](./system-flows.review.repository.ts)                     | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`system-flows.review.schemas.ts`](./system-flows.review.schemas.ts)                           | Esquemas Zod: validan entradas y parámetros en el borde del sistema.           |
| [`system-flows.review.service.ts`](./system-flows.review.service.ts)                           | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`system-flows.review.util.ts`](./system-flows.review.util.ts)                                 | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`system-flows.risk.util.ts`](./system-flows.risk.util.ts)                                     | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`system-flows.schemas.ts`](./system-flows.schemas.ts)                                         | Esquemas Zod: validan entradas y parámetros en el borde del sistema.           |
| [`system-flows.screens.repository.ts`](./system-flows.screens.repository.ts)                   | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`system-flows.screens.service.ts`](./system-flows.screens.service.ts)                         | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`system-flows.service.ts`](./system-flows.service.ts)                                         | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`system-flows.sql.constants.ts`](./system-flows.sql.constants.ts)                             | Artefacto de soporte específico de esta carpeta.                               |
| [`system-flows.verification.util.ts`](./system-flows.verification.util.ts)                     | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`system-flows.where.util.ts`](./system-flows.where.util.ts)                                   | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`system-governance-catalog.repository.ts`](./system-governance-catalog.repository.ts)         | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`system-tool-catalog.repository.ts`](./system-tool-catalog.repository.ts)                     | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`systems-action-log-query.service.ts`](./systems-action-log-query.service.ts)                 | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-action-log.controller.ts`](./systems-action-log.controller.ts)                       | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`systems-action-log.repository.ts`](./systems-action-log.repository.ts)                       | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`systems-actor.util.ts`](./systems-actor.util.ts)                                             | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`systems-business-metadata.fixtures.ts`](./systems-business-metadata.fixtures.ts)             | Artefacto de soporte específico de esta carpeta.                               |
| [`systems-catalog-auto-sync.service.ts`](./systems-catalog-auto-sync.service.ts)               | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-catalog-classifier.service.ts`](./systems-catalog-classifier.service.ts)             | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-catalog-query.service.ts`](./systems-catalog-query.service.ts)                       | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-catalog-rows.ts`](./systems-catalog-rows.ts)                                         | Artefacto de soporte específico de esta carpeta.                               |
| [`systems-catalog-seed.service.ts`](./systems-catalog-seed.service.ts)                         | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-catalog-sql.constants.ts`](./systems-catalog-sql.constants.ts)                       | Artefacto de soporte específico de esta carpeta.                               |
| [`systems-catalog-summary.service.ts`](./systems-catalog-summary.service.ts)                   | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-catalog.controller.ts`](./systems-catalog.controller.ts)                             | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`systems-controller.decorators.ts`](./systems-controller.decorators.ts)                       | Artefacto de soporte específico de esta carpeta.                               |
| [`systems-dashboard.repository.ts`](./systems-dashboard.repository.ts)                         | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`systems-data-impact-inference.repository.ts`](./systems-data-impact-inference.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`systems-data-impact-inference.service.ts`](./systems-data-impact-inference.service.ts)       | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-domain-overview.service.ts`](./systems-domain-overview.service.ts)                   | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-endpoint-docs.service.ts`](./systems-endpoint-docs.service.ts)                       | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-entity-narrative.mapper.ts`](./systems-entity-narrative.mapper.ts)                   | Mapper: transforma modelos internos a contratos de transporte.                 |
| [`systems-erp-inventory.service.ts`](./systems-erp-inventory.service.ts)                       | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-header-redaction.util.ts`](./systems-header-redaction.util.ts)                       | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`systems-health-monitor.service.ts`](./systems-health-monitor.service.ts)                     | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-health.service.ts`](./systems-health.service.ts)                                     | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-json-path.util.ts`](./systems-json-path.util.ts)                                     | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`systems-monitor-host.controller.ts`](./systems-monitor-host.controller.ts)                   | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`systems-monitor-host.schemas.ts`](./systems-monitor-host.schemas.ts)                         | Esquemas Zod: validan entradas y parámetros en el borde del sistema.           |
| [`systems-monitor-host.store.ts`](./systems-monitor-host.store.ts)                             | Artefacto de soporte específico de esta carpeta.                               |
| [`systems-monitor-summary.service.ts`](./systems-monitor-summary.service.ts)                   | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-monitor.controller.ts`](./systems-monitor.controller.ts)                             | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`systems-monitor.module.ts`](./systems-monitor.module.ts)                                     | Módulo NestJS: declara el límite de inyección y sus dependencias.              |
| [`systems-monitor.rules.ts`](./systems-monitor.rules.ts)                                       | Artefacto de soporte específico de esta carpeta.                               |
| [`systems-network-health.service.ts`](./systems-network-health.service.ts)                     | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-network.controller.ts`](./systems-network.controller.ts)                             | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`systems-ops.constants.ts`](./systems-ops.constants.ts)                                       | Artefacto de soporte específico de esta carpeta.                               |
| [`systems-ops.dtos.ts`](./systems-ops.dtos.ts)                                                 | DTOs: contrato estable de salida sin filtrar modelos de persistencia.          |
| [`systems-ops.mapper.ts`](./systems-ops.mapper.ts)                                             | Mapper: transforma modelos internos a contratos de transporte.                 |
| [`systems-ops.module.ts`](./systems-ops.module.ts)                                             | Módulo NestJS: declara el límite de inyección y sus dependencias.              |
| [`systems-ops.params.schemas.ts`](./systems-ops.params.schemas.ts)                             | Esquemas Zod: validan entradas y parámetros en el borde del sistema.           |
| [`systems-ops.query.schemas.ts`](./systems-ops.query.schemas.ts)                               | Esquemas Zod: validan entradas y parámetros en el borde del sistema.           |
| [`systems-ops.schemas.ts`](./systems-ops.schemas.ts)                                           | Esquemas Zod: validan entradas y parámetros en el borde del sistema.           |
| [`systems-ops.test-run.mapper.ts`](./systems-ops.test-run.mapper.ts)                           | Mapper: transforma modelos internos a contratos de transporte.                 |
| [`systems-ops.test-suite.schemas.ts`](./systems-ops.test-suite.schemas.ts)                     | Esquemas Zod: validan entradas y parámetros en el borde del sistema.           |
| [`systems-ops.tool.mapper.ts`](./systems-ops.tool.mapper.ts)                                   | Mapper: transforma modelos internos a contratos de transporte.                 |
| [`systems-ops.types.ts`](./systems-ops.types.ts)                                               | Tipos de dominio: hacen explícitos estados y contratos internos.               |
| [`systems-repository-where.util.ts`](./systems-repository-where.util.ts)                       | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`systems-review-where.util.ts`](./systems-review-where.util.ts)                               | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`systems-review.controller.ts`](./systems-review.controller.ts)                               | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`systems-review.repository.ts`](./systems-review.repository.ts)                               | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`systems-review.service.ts`](./systems-review.service.ts)                                     | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-sanitizer.ts`](./systems-sanitizer.ts)                                               | Artefacto de soporte específico de esta carpeta.                               |
| [`systems-schema-introspection.service.ts`](./systems-schema-introspection.service.ts)         | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-seed-fixtures.business.ts`](./systems-seed-fixtures.business.ts)                     | Seeder idempotente: instala datos de referencia o fixtures del perfil.         |
| [`systems-seed-fixtures.platform.ts`](./systems-seed-fixtures.platform.ts)                     | Seeder idempotente: instala datos de referencia o fixtures del perfil.         |
| [`systems-seed-fixtures.ts`](./systems-seed-fixtures.ts)                                       | Seeder idempotente: instala datos de referencia o fixtures del perfil.         |
| [`systems-source-scan.util.ts`](./systems-source-scan.util.ts)                                 | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`systems-stress-consumer.service.ts`](./systems-stress-consumer.service.ts)                   | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-stress-executor.service.ts`](./systems-stress-executor.service.ts)                   | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-stress-metrics.util.ts`](./systems-stress-metrics.util.ts)                           | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`systems-stress-profile.repository.ts`](./systems-stress-profile.repository.ts)               | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`systems-stress-profile.service.ts`](./systems-stress-profile.service.ts)                     | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-stress-run.service.ts`](./systems-stress-run.service.ts)                             | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-stress-run.where.util.ts`](./systems-stress-run.where.util.ts)                       | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`systems-stress.controller.ts`](./systems-stress.controller.ts)                               | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`systems-tenant-scope.util.ts`](./systems-tenant-scope.util.ts)                               | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`systems-test-assertion.service.ts`](./systems-test-assertion.service.ts)                     | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-test-execution.repository.ts`](./systems-test-execution.repository.ts)               | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`systems-test-http-client.service.ts`](./systems-test-http-client.service.ts)                 | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-test-query.service.ts`](./systems-test-query.service.ts)                             | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-test-runner.service.ts`](./systems-test-runner.service.ts)                           | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-test-suite-admin.repository.ts`](./systems-test-suite-admin.repository.ts)           | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`systems-test-suite-admin.service.ts`](./systems-test-suite-admin.service.ts)                 | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-test-template.service.ts`](./systems-test-template.service.ts)                       | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-test-url-policy.util.ts`](./systems-test-url-policy.util.ts)                         | Utilidad pura o acotada reutilizable dentro de su capa.                        |
| [`systems-test.controller.ts`](./systems-test.controller.ts)                                   | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`systems-tool-inference.repository.ts`](./systems-tool-inference.repository.ts)               | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`systems-tool-inference.service.ts`](./systems-tool-inference.service.ts)                     | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`systems-traffic-report.schemas.ts`](./systems-traffic-report.schemas.ts)                     | Esquemas Zod: validan entradas y parámetros en el borde del sistema.           |

## Subcarpetas

- [`entity-narratives/`](./entity-narratives/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
