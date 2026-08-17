<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/database/migrations

## Por qué existe

- **Negocio:** esta carpeta preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
- **Sistema:** esta carpeta define migrations para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`20260626154044-schema-part-0-platform-core.ts`](./20260626154044-schema-part-0-platform-core.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260626154045-schema-part-1-customers-identity.ts`](./20260626154045-schema-part-1-customers-identity.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260626154046-schema-part-2-privacy-consents.ts`](./20260626154046-schema-part-2-privacy-consents.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260626154047-schema-part-3-devices-sessions.ts`](./20260626154047-schema-part-3-devices-sessions.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260626154048-schema-part-4-onboarding-behavior.ts`](./20260626154048-schema-part-4-onboarding-behavior.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260626154049-schema-part-5-catalog-context.ts`](./20260626154049-schema-part-5-catalog-context.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260626154050-schema-part-6-features-scoring.ts`](./20260626154050-schema-part-6-features-scoring.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260626154051-schema-part-7-risk-engine.ts`](./20260626154051-schema-part-7-risk-engine.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260626154052-schema-part-8-fraud-review.ts`](./20260626154052-schema-part-8-fraud-review.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260626154053-schema-part-9-audit-quality.ts`](./20260626154053-schema-part-9-audit-quality.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260626154054-schema-relationships-part-0-platform-core.ts`](./20260626154054-schema-relationships-part-0-platform-core.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260626154055-schema-relationships-part-1-customers-identity.ts`](./20260626154055-schema-relationships-part-1-customers-identity.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260626154056-schema-relationships-part-2-privacy-consents.ts`](./20260626154056-schema-relationships-part-2-privacy-consents.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260626154057-schema-relationships-part-3-devices-sessions.ts`](./20260626154057-schema-relationships-part-3-devices-sessions.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260626154058-schema-relationships-part-4-onboarding-behavior.ts`](./20260626154058-schema-relationships-part-4-onboarding-behavior.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260626154059-schema-relationships-part-5-catalog-context.ts`](./20260626154059-schema-relationships-part-5-catalog-context.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260626154100-schema-relationships-part-6-features-scoring.ts`](./20260626154100-schema-relationships-part-6-features-scoring.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260626154101-schema-relationships-part-7-risk-engine.ts`](./20260626154101-schema-relationships-part-7-risk-engine.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260626154102-schema-relationships-part-8-fraud-review.ts`](./20260626154102-schema-relationships-part-8-fraud-review.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260626154103-schema-relationships-part-9-audit-quality.ts`](./20260626154103-schema-relationships-part-9-audit-quality.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260629170000-add-runtime-hardening-tables.ts`](./20260629170000-add-runtime-hardening-tables.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260630183000-patch-2-event-messaging-core.ts`](./20260630183000-patch-2-event-messaging-core.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260630193000-patch-2-real-notification-adapters.ts`](./20260630193000-patch-2-real-notification-adapters.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260701000000-add-auth-credentials-and-email-uniqueness.ts`](./20260701000000-add-auth-credentials-and-email-uniqueness.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260702031000-add-external-data-provider-orchestration.ts`](./20260702031000-add-external-data-provider-orchestration.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260702040000-add-external-provider-resilience-v4.ts`](./20260702040000-add-external-provider-resilience-v4.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260702043000-hardening-external-providers-v6.ts`](./20260702043000-hardening-external-providers-v6.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260703001000-add-systems-ops-catalog-qa-audit.ts`](./20260703001000-add-systems-ops-catalog-qa-audit.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260703011000-add-systems-ops-phase2-review-stress.ts`](./20260703011000-add-systems-ops-phase2-review-stress.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260703035812-add-unified-audit-event-feed-view.ts`](./20260703035812-add-unified-audit-event-feed-view.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260704120000-add-internal-rbac-module.ts`](./20260704120000-add-internal-rbac-module.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260705113000-add-systems-business-metadata-governance.ts`](./20260705113000-add-systems-business-metadata-governance.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260705113000-add-systems-ops-rich-metadata-tables.ts`](./20260705113000-add-systems-ops-rich-metadata-tables.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260705113500-extend-endpoint-data-entity-impacts.ts`](./20260705113500-extend-endpoint-data-entity-impacts.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260706030000-phase-4a-create-schema-versions.ts`](./20260706030000-phase-4a-create-schema-versions.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260706040000-phase-4a-create-schema-tables.ts`](./20260706040000-phase-4a-create-schema-tables.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260706050000-phase-4a-create-schema-columns.ts`](./20260706050000-phase-4a-create-schema-columns.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260706060000-phase-4a-create-schema-relationships.ts`](./20260706060000-phase-4a-create-schema-relationships.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260706070000-phase-4a-create-schema-change-log.ts`](./20260706070000-phase-4a-create-schema-change-log.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260706090000-create-catalog-entries.ts`](./20260706090000-create-catalog-entries.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260706110000-phase-4b-add-approval-notes-to-schema-change-log.ts`](./20260706110000-phase-4b-add-approval-notes-to-schema-change-log.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260706120000-widen-system-data-relationship-optionality.ts`](./20260706120000-widen-system-data-relationship-optionality.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260707120000-add-systems-data-column-catalog-runtime.ts`](./20260707120000-add-systems-data-column-catalog-runtime.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260709090000-add-is-worker-to-system-tool-catalog.ts`](./20260709090000-add-is-worker-to-system-tool-catalog.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260710090000-add-owner-domain-to-definitions.ts`](./20260710090000-add-owner-domain-to-definitions.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260711100000-add-tenant-scope-to-systems-ops-runtime.ts`](./20260711100000-add-tenant-scope-to-systems-ops-runtime.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260711101000-create-system-catalog-review-events.ts`](./20260711101000-create-system-catalog-review-events.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260711120000-add-covering-index-system-action-logs-traffic.ts`](./20260711120000-add-covering-index-system-action-logs-traffic.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260711130000-add-notification-category-icon.ts`](./20260711130000-add-notification-category-icon.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260713000000-add-context-catalog-natural-key-indexes.ts`](./20260713000000-add-context-catalog-natural-key-indexes.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260713100000-add-backend-service-to-system-endpoint-catalog.ts`](./20260713100000-add-backend-service-to-system-endpoint-catalog.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260713120000-add-context-seed-governance-and-checkpoints.ts`](./20260713120000-add-context-seed-governance-and-checkpoints.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260714000000-add-auth-one-time-codes.ts`](./20260714000000-add-auth-one-time-codes.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260715120000-create-read-api-schema-and-views-v1.ts`](./20260715120000-create-read-api-schema-and-views-v1.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260717000000-add-customer-mfa-to-auth-credentials.ts`](./20260717000000-add-customer-mfa-to-auth-credentials.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260717120000-split-write-model-into-domain-schemas.ts`](./20260717120000-split-write-model-into-domain-schemas.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260721120000-harden-deleted-flag-not-null.ts`](./20260721120000-harden-deleted-flag-not-null.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260727120000-add-entity-business-narrative-columns.ts`](./20260727120000-add-entity-business-narrative-columns.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260728090000-add-customer-lifecycle-state-machine-and-eligibility.ts`](./20260728090000-add-customer-lifecycle-state-machine-and-eligibility.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260728120000-create-credit-products-and-applications.ts`](./20260728120000-create-credit-products-and-applications.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260728140000-create-workflow-catalog.ts`](./20260728140000-create-workflow-catalog.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260811090000-create-loan-book.ts`](./20260811090000-create-loan-book.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`20260811100000-link-credit-applications-to-decision-engine.ts`](./20260811100000-link-credit-applications-to-decision-engine.ts) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
