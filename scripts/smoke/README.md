<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# scripts/smoke

## Por qué existe

- **Negocio:** esta carpeta convierte operaciones delicadas en procedimientos repetibles y verificables.
- **Sistema:** esta carpeta automatiza gates, desarrollo, migraciones, seeds, smokes y mantenimiento.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`auth.smoke.ts`](./auth.smoke.ts) | Artefacto de soporte específico de esta carpeta. |
| [`catalog.smoke.ts`](./catalog.smoke.ts) | Artefacto de soporte específico de esta carpeta. |
| [`core.smoke.ts`](./core.smoke.ts) | Artefacto de soporte específico de esta carpeta. |
| [`events.smoke.ts`](./events.smoke.ts) | Artefacto de soporte específico de esta carpeta. |
| [`external-providers-errors.smoke.ts`](./external-providers-errors.smoke.ts) | Artefacto de soporte específico de esta carpeta. |
| [`external-providers-governance.smoke.ts`](./external-providers-governance.smoke.ts) | Artefacto de soporte específico de esta carpeta. |
| [`external-providers.smoke.ts`](./external-providers.smoke.ts) | Artefacto de soporte específico de esta carpeta. |
| [`frontend-contract.smoke.ts`](./frontend-contract.smoke.ts) | Artefacto de soporte específico de esta carpeta. |
| [`http.ts`](./http.ts) | Artefacto de soporte específico de esta carpeta. |
| [`index.ts`](./index.ts) | Artefacto de soporte específico de esta carpeta. |
| [`internal-rbac.smoke.ts`](./internal-rbac.smoke.ts) | Artefacto de soporte específico de esta carpeta. |
| [`notifications.smoke.ts`](./notifications.smoke.ts) | Artefacto de soporte específico de esta carpeta. |
| [`partner-onboarding.smoke.ts`](./partner-onboarding.smoke.ts) | Artefacto de soporte específico de esta carpeta. |
| [`redact.ts`](./redact.ts) | Artefacto de soporte específico de esta carpeta. |
| [`required-smoke-env.ts`](./required-smoke-env.ts) | Artefacto de soporte específico de esta carpeta. |
| [`risk-telemetry.smoke.ts`](./risk-telemetry.smoke.ts) | Artefacto de soporte específico de esta carpeta. |
| [`runtime.smoke.ts`](./runtime.smoke.ts) | Artefacto de soporte específico de esta carpeta. |
| [`sessions.smoke.ts`](./sessions.smoke.ts) | Artefacto de soporte específico de esta carpeta. |
| [`user-types.smoke.ts`](./user-types.smoke.ts) | Artefacto de soporte específico de esta carpeta. |
| [`workflow-catalog.smoke.ts`](./workflow-catalog.smoke.ts) | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
