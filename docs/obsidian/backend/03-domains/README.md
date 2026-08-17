<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/obsidian/backend/03-domains

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta 03-domains como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`index.md`](./index.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Subcarpetas

- [`audit/`](./audit/README.md)
- [`auth/`](./auth/README.md)
- [`catalog-management/`](./catalog-management/README.md)
- [`consents/`](./consents/README.md)
- [`credit/`](./credit/README.md)
- [`customer-onboarding/`](./customer-onboarding/README.md)
- [`customer-privacy/`](./customer-privacy/README.md)
- [`customer-telemetry/`](./customer-telemetry/README.md)
- [`customers/`](./customers/README.md)
- [`data-quality/`](./data-quality/README.md)
- [`events/`](./events/README.md)
- [`external-data/`](./external-data/README.md)
- [`fraud/`](./fraud/README.md)
- [`health/`](./health/README.md)
- [`internal-portal/`](./internal-portal/README.md)
- [`internal-users/`](./internal-users/README.md)
- [`log-sync/`](./log-sync/README.md)
- [`mail-sender/`](./mail-sender/README.md)
- [`notifications/`](./notifications/README.md)
- [`operations/`](./operations/README.md)
- [`risk/`](./risk/README.md)
- [`runtime-hardening/`](./runtime-hardening/README.md)
- [`runtime-jobs/`](./runtime-jobs/README.md)
- [`schema-management/`](./schema-management/README.md)
- [`sessions/`](./sessions/README.md)
- [`systems-ops/`](./systems-ops/README.md)
- [`workflow-catalog/`](./workflow-catalog/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
