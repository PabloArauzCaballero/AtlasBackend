<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules

## Por qué existe

- **Negocio:** esta carpeta implementa las capacidades operativas, de identidad, riesgo y crédito de Atlas.
- **Sistema:** esta carpeta organiza el runtime NestJS en módulos con límites explícitos y dependencias dirigidas.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| — | Esta carpeta funciona como agrupador; su contenido está en subcarpetas. |

## Subcarpetas

- [`app-content/`](./app-content/README.md)
- [`audit/`](./audit/README.md)
- [`auth/`](./auth/README.md)
- [`catalog-management/`](./catalog-management/README.md)
- [`consents/`](./consents/README.md)
- [`credit/`](./credit/README.md)
- [`credit-rating/`](./credit-rating/README.md)
- [`customer-onboarding/`](./customer-onboarding/README.md)
- [`customer-privacy/`](./customer-privacy/README.md)
- [`customer-telemetry/`](./customer-telemetry/README.md)
- [`customers/`](./customers/README.md)
- [`data-notebook/`](./data-notebook/README.md)
- [`data-quality/`](./data-quality/README.md)
- [`decision-engine/`](./decision-engine/README.md)
- [`events/`](./events/README.md)
- [`external-data/`](./external-data/README.md)
- [`fraud/`](./fraud/README.md)
- [`health/`](./health/README.md)
- [`internal-portal/`](./internal-portal/README.md)
- [`internal-users/`](./internal-users/README.md)
- [`loan-payment-claims/`](./loan-payment-claims/README.md)
- [`loans/`](./loans/README.md)
- [`log-sync/`](./log-sync/README.md)
- [`mail-sender/`](./mail-sender/README.md)
- [`merchant-identity/`](./merchant-identity/README.md)
- [`mobile-identity/`](./mobile-identity/README.md)
- [`mobile-welcome-audio/`](./mobile-welcome-audio/README.md)
- [`notifications/`](./notifications/README.md)
- [`operations/`](./operations/README.md)
- [`partner-onboarding/`](./partner-onboarding/README.md)
- [`risk/`](./risk/README.md)
- [`runtime-hardening/`](./runtime-hardening/README.md)
- [`runtime-jobs/`](./runtime-jobs/README.md)
- [`schema-management/`](./schema-management/README.md)
- [`sessions/`](./sessions/README.md)
- [`sql-console/`](./sql-console/README.md)
- [`systems-ops/`](./systems-ops/README.md)
- [`workflow-catalog/`](./workflow-catalog/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
