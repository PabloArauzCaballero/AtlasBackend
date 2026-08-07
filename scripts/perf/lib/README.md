<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# scripts/perf/lib

## Por qué existe

- **Negocio:** esta carpeta convierte operaciones delicadas en procedimientos repetibles y verificables.
- **Sistema:** esta carpeta automatiza gates, desarrollo, migraciones, seeds, smokes y mantenimiento.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`budget.ts`](./budget.ts) | Artefacto de soporte específico de esta carpeta. |
| [`capacity.ts`](./capacity.ts) | Artefacto de soporte específico de esta carpeta. |
| [`evidence.ts`](./evidence.ts) | Artefacto de soporte específico de esta carpeta. |
| [`host-resources.ts`](./host-resources.ts) | Artefacto de soporte específico de esta carpeta. |
| [`load-engine.ts`](./load-engine.ts) | Artefacto de soporte específico de esta carpeta. |
| [`load-flows.ts`](./load-flows.ts) | Artefacto de soporte específico de esta carpeta. |
| [`metrics-probe.ts`](./metrics-probe.ts) | Artefacto de soporte específico de esta carpeta. |
| [`project-processes.ts`](./project-processes.ts) | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
