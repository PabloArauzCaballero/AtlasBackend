<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# scripts/perf

## Por qué existe

- **Negocio:** esta carpeta convierte operaciones delicadas en procedimientos repetibles y verificables.
- **Sistema:** esta carpeta automatiza gates, desarrollo, migraciones, seeds, smokes y mantenimiento.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`load.ts`](./load.ts) | Artefacto de soporte específico de esta carpeta. |
| [`prestart-cleanup.ts`](./prestart-cleanup.ts) | Artefacto de soporte específico de esta carpeta. |
| [`prestart-diagnose.ts`](./prestart-diagnose.ts) | Artefacto de soporte específico de esta carpeta. |
| [`prestart-verify.ts`](./prestart-verify.ts) | Artefacto de soporte específico de esta carpeta. |

## Subcarpetas

- [`lib/`](./lib/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
