<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/config

## Por qué existe

- **Negocio:** esta carpeta evita operar con parámetros inseguros o ambiguos.
- **Sistema:** esta carpeta valida y compone configuración tipada al arrancar.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`app-role.ts`](./app-role.ts) | Artefacto de soporte específico de esta carpeta. |
| [`build-info.ts`](./build-info.ts) | Artefacto de soporte específico de esta carpeta. |
| [`database.config.ts`](./database.config.ts) | Artefacto de soporte específico de esta carpeta. |
| [`env-cross-checks.ts`](./env-cross-checks.ts) | Artefacto de soporte específico de esta carpeta. |
| [`env.database.schema.ts`](./env.database.schema.ts) | Artefacto de soporte específico de esta carpeta. |
| [`env.decision-engine.checks.ts`](./env.decision-engine.checks.ts) | Artefacto de soporte específico de esta carpeta. |
| [`env.decision-engine.schema.ts`](./env.decision-engine.schema.ts) | Artefacto de soporte específico de esta carpeta. |
| [`env.erp.schema.ts`](./env.erp.schema.ts) | Artefacto de soporte específico de esta carpeta. |
| [`env.files.checks.ts`](./env.files.checks.ts) | Artefacto de soporte específico de esta carpeta. |
| [`env.files.schema.ts`](./env.files.schema.ts) | Artefacto de soporte específico de esta carpeta. |
| [`env.notification-providers.checks.ts`](./env.notification-providers.checks.ts) | Artefacto de soporte específico de esta carpeta. |
| [`env.primitives.ts`](./env.primitives.ts) | Artefacto de soporte específico de esta carpeta. |
| [`env.runtime-jobs.schema.ts`](./env.runtime-jobs.schema.ts) | Artefacto de soporte específico de esta carpeta. |
| [`env.schema.ts`](./env.schema.ts) | Artefacto de soporte específico de esta carpeta. |
| [`env.ts`](./env.ts) | Artefacto de soporte específico de esta carpeta. |
| [`swagger.ts`](./swagger.ts) | Artefacto de soporte específico de esta carpeta. |

## Subcarpetas

- [`openapi/`](./openapi/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
