<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/config/openapi

## Por qué existe

- **Negocio:** esta carpeta evita operar con parámetros inseguros o ambiguos.
- **Sistema:** esta carpeta valida y compone configuración tipada al arrancar.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`api-reference.setup.ts`](./api-reference.setup.ts) | Artefacto de soporte específico de esta carpeta. |
| [`contract-components.ts`](./contract-components.ts) | Artefacto de soporte específico de esta carpeta. |
| [`contract-parameters.ts`](./contract-parameters.ts) | Artefacto de soporte específico de esta carpeta. |
| [`contract-tags.ts`](./contract-tags.ts) | Artefacto de soporte específico de esta carpeta. |
| [`contract-types.ts`](./contract-types.ts) | Artefacto de soporte específico de esta carpeta. |
| [`enrich-document.ts`](./enrich-document.ts) | Artefacto de soporte específico de esta carpeta. |
| [`normalize-contract.ts`](./normalize-contract.ts) | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
