<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit

## Por qué existe

- **Negocio:** esta carpeta previene regresiones que afectarían los contratos críticos del backend.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; valida componentes aislados.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`credit-rating-scale-catalog.spec.ts`](./credit-rating-scale-catalog.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`idempotency-hash.test.ts`](./idempotency-hash.test.ts) | Artefacto de soporte específico de esta carpeta. |
| [`multidomain-context-loader.spec.ts`](./multidomain-context-loader.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`payment-capacity.spec.ts`](./payment-capacity.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`redaction.test.ts`](./redaction.test.ts) | Artefacto de soporte específico de esta carpeta. |
| [`statement-rejection.spec.ts`](./statement-rejection.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-ops-action-log-filter-catalog.spec.ts`](./systems-ops-action-log-filter-catalog.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-ops-catalog-repository-deprecation.spec.ts`](./systems-ops-catalog-repository-deprecation.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-ops-endpoint-discovery-persist.spec.ts`](./systems-ops-endpoint-discovery-persist.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-ops-endpoint-discovery-security.spec.ts`](./systems-ops-endpoint-discovery-security.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-ops-endpoint.util.spec.ts`](./systems-ops-endpoint.util.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-ops-platform-service-health-probe.spec.ts`](./systems-ops-platform-service-health-probe.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-ops-suite-admin.spec.ts`](./systems-ops-suite-admin.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-ops-tenant-scope.spec.ts`](./systems-ops-tenant-scope.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-ops-test-runner-ssrf.spec.ts`](./systems-ops-test-runner-ssrf.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-ops-test-runner-utils.spec.ts`](./systems-ops-test-runner-utils.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-ops-url-policy.spec.ts`](./systems-ops-url-policy.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-ops-write-roles.spec.ts`](./systems-ops-write-roles.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Subcarpetas

- [`audit/`](./audit/README.md)
- [`auth/`](./auth/README.md)
- [`bootstrap/`](./bootstrap/README.md)
- [`catalog-management/`](./catalog-management/README.md)
- [`common/`](./common/README.md)
- [`config/`](./config/README.md)
- [`consents/`](./consents/README.md)
- [`credit/`](./credit/README.md)
- [`credit-rating/`](./credit-rating/README.md)
- [`crypto/`](./crypto/README.md)
- [`customer-onboarding/`](./customer-onboarding/README.md)
- [`customer-privacy/`](./customer-privacy/README.md)
- [`customer-telemetry/`](./customer-telemetry/README.md)
- [`customers/`](./customers/README.md)
- [`data-notebook/`](./data-notebook/README.md)
- [`data-quality/`](./data-quality/README.md)
- [`database/`](./database/README.md)
- [`decision-engine/`](./decision-engine/README.md)
- [`events/`](./events/README.md)
- [`external-data/`](./external-data/README.md)
- [`files/`](./files/README.md)
- [`fraud/`](./fraud/README.md)
- [`health/`](./health/README.md)
- [`internal-portal/`](./internal-portal/README.md)
- [`internal-users/`](./internal-users/README.md)
- [`loans/`](./loans/README.md)
- [`log-sync/`](./log-sync/README.md)
- [`mail-sender/`](./mail-sender/README.md)
- [`merchant-identity/`](./merchant-identity/README.md)
- [`mobile-identity/`](./mobile-identity/README.md)
- [`mobile-welcome-audio/`](./mobile-welcome-audio/README.md)
- [`notifications/`](./notifications/README.md)
- [`observability/`](./observability/README.md)
- [`openapi/`](./openapi/README.md)
- [`operations/`](./operations/README.md)
- [`partner-onboarding/`](./partner-onboarding/README.md)
- [`resilience/`](./resilience/README.md)
- [`risk/`](./risk/README.md)
- [`runtime-hardening/`](./runtime-hardening/README.md)
- [`runtime-jobs/`](./runtime-jobs/README.md)
- [`schema-management/`](./schema-management/README.md)
- [`sessions/`](./sessions/README.md)
- [`smoke/`](./smoke/README.md)
- [`sql-console/`](./sql-console/README.md)
- [`storage/`](./storage/README.md)
- [`support/`](./support/README.md)
- [`systems-ops/`](./systems-ops/README.md)
- [`worker/`](./worker/README.md)
- [`workflow-catalog/`](./workflow-catalog/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
