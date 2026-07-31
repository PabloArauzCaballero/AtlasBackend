<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/sessions/repositories

## Por qué existe

- **Negocio:** esta carpeta mantiene continuidad, seguridad y señales de uso durante la interacción del cliente.
- **Sistema:** esta carpeta orquesta inicio, heartbeat, cierre, ubicación, dispositivo y auditoría del ciclo de sesión.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`sessions-activity-audit.repository.ts`](./sessions-activity-audit.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`sessions-device.repository.ts`](./sessions-device.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`sessions-lifecycle.repository.ts`](./sessions-lifecycle.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`sessions-location.repository.ts`](./sessions-location.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`sessions-onboarding-link.repository.ts`](./sessions-onboarding-link.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`sessions-telemetry.repository.ts`](./sessions-telemetry.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
