<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/systems-ops/entity-narratives

## Por qué existe

- **Negocio:** esta carpeta hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
- **Sistema:** esta carpeta descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`audit-quality.fixtures.ts`](./audit-quality.fixtures.ts) | Artefacto de soporte específico de esta carpeta. |
| [`communications.fixtures.ts`](./communications.fixtures.ts) | Artefacto de soporte específico de esta carpeta. |
| [`context-catalogs.fixtures.ts`](./context-catalogs.fixtures.ts) | Artefacto de soporte específico de esta carpeta. |
| [`credit-lifecycle.fixtures.ts`](./credit-lifecycle.fixtures.ts) | Artefacto de soporte específico de esta carpeta. |
| [`customer-identity.fixtures.ts`](./customer-identity.fixtures.ts) | Artefacto de soporte específico de esta carpeta. |
| [`device-intelligence.fixtures.ts`](./device-intelligence.fixtures.ts) | Artefacto de soporte específico de esta carpeta. |
| [`entity-narrative.types.ts`](./entity-narrative.types.ts) | Tipos de dominio: hacen explícitos estados y contratos internos. |
| [`evidence.fixtures.ts`](./evidence.fixtures.ts) | Artefacto de soporte específico de esta carpeta. |
| [`external-providers.fixtures.ts`](./external-providers.fixtures.ts) | Artefacto de soporte específico de esta carpeta. |
| [`fraud-review.fixtures.ts`](./fraud-review.fixtures.ts) | Artefacto de soporte específico de esta carpeta. |
| [`index.ts`](./index.ts) | Artefacto de soporte específico de esta carpeta. |
| [`loan-book.fixtures.ts`](./loan-book.fixtures.ts) | Artefacto de soporte específico de esta carpeta. |
| [`onboarding-behavior.fixtures.ts`](./onboarding-behavior.fixtures.ts) | Artefacto de soporte específico de esta carpeta. |
| [`platform-access.fixtures.ts`](./platform-access.fixtures.ts) | Artefacto de soporte específico de esta carpeta. |
| [`privacy-consent.fixtures.ts`](./privacy-consent.fixtures.ts) | Artefacto de soporte específico de esta carpeta. |
| [`risk-scoring.fixtures.ts`](./risk-scoring.fixtures.ts) | Artefacto de soporte específico de esta carpeta. |
| [`systems-governance.fixtures.ts`](./systems-governance.fixtures.ts) | Artefacto de soporte específico de esta carpeta. |
| [`workflow-catalog.fixtures.ts`](./workflow-catalog.fixtures.ts) | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
