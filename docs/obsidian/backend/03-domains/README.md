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

- [`audit/`](./audit/index.md)
- [`auth/`](./auth/index.md)
- [`catalog-management/`](./catalog-management/index.md)
- [`consents/`](./consents/index.md)
- [`credit/`](./credit/index.md)
- [`customer-onboarding/`](./customer-onboarding/index.md)
- [`customer-privacy/`](./customer-privacy/index.md)
- [`customer-telemetry/`](./customer-telemetry/index.md)
- [`customers/`](./customers/index.md)
- [`data-quality/`](./data-quality/index.md)
- [`events/`](./events/index.md)
- [`external-data/`](./external-data/index.md)
- [`fraud/`](./fraud/index.md)
- [`health/`](./health/index.md)
- [`internal-portal/`](./internal-portal/index.md)
- [`internal-users/`](./internal-users/index.md)
- [`log-sync/`](./log-sync/index.md)
- [`mail-sender/`](./mail-sender/index.md)
- [`notifications/`](./notifications/index.md)
- [`operations/`](./operations/index.md)
- [`risk/`](./risk/index.md)
- [`runtime-hardening/`](./runtime-hardening/index.md)
- [`runtime-jobs/`](./runtime-jobs/index.md)
- [`schema-management/`](./schema-management/index.md)
- [`sessions/`](./sessions/index.md)
- [`systems-ops/`](./systems-ops/index.md)
- [`workflow-catalog/`](./workflow-catalog/index.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
