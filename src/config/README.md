<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/config

## Por qué existe

- **Negocio:** esta carpeta evita operar con parámetros inseguros o ambiguos.
- **Sistema:** esta carpeta valida y compone configuración tipada al arrancar.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`build-info.ts`](./build-info.ts) | Artefacto de soporte específico de esta carpeta. |
| [`database.config.ts`](./database.config.ts) | Artefacto de soporte específico de esta carpeta. |
| [`env-cross-checks.ts`](./env-cross-checks.ts) | Artefacto de soporte específico de esta carpeta. |
| [`env.schema.ts`](./env.schema.ts) | Artefacto de soporte específico de esta carpeta. |
| [`env.ts`](./env.ts) | Artefacto de soporte específico de esta carpeta. |
| [`swagger.ts`](./swagger.ts) | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
