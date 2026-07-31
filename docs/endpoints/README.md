<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/endpoints

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta endpoints como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`api-contract.md`](./api-contract.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`endpoints.md`](./endpoints.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`openapi-systems-ops.yaml`](./openapi-systems-ops.yaml) | Configuración declarativa legible y versionada. |
| [`openapi.yaml`](./openapi.yaml) | Configuración declarativa legible y versionada. |
| [`workflow-catalog.md`](./workflow-catalog.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
