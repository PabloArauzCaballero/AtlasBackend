<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/obsidian/backend/04-api/rest

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta rest como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`audit.md`](./audit.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`auth.md`](./auth.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`bureau.md`](./bureau.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`catalog-management.md`](./catalog-management.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`consents.md`](./consents.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`credit.md`](./credit.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`customer-eligibility.md`](./customer-eligibility.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`customer-onboarding.md`](./customer-onboarding.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`customer-privacy.md`](./customer-privacy.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`customer-telemetry.md`](./customer-telemetry.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`customers.md`](./customers.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`data-quality.md`](./data-quality.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`digital-trust.md`](./digital-trust.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`events.md`](./events.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`external-data-admin.md`](./external-data-admin.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`external-data.md`](./external-data.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`health.md`](./health.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`internal-access-catalog.md`](./internal-access-catalog.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`internal-admin-views.md`](./internal-admin-views.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`internal-auth.md`](./internal-auth.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`internal-portal.md`](./internal-portal.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`internal-users.md`](./internal-users.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`kyc.md`](./kyc.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`metrics.md`](./metrics.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`notifications.md`](./notifications.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`operations.md`](./operations.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`payments-external.md`](./payments-external.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`risk.md`](./risk.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`runtime-jobs.md`](./runtime-jobs.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`schema-management.md`](./schema-management.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`sessions.md`](./sessions.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`social.md`](./social.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`systems-ops.md`](./systems-ops.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`telco.md`](./telco.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`whatsapp.md`](./whatsapp.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`workflow-catalog.md`](./workflow-catalog.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
