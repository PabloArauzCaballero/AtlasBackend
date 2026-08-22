<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/obsidian/backend/13-change-impact

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta 13-change-impact como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`change-checklists.md`](./change-checklists.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`compatibility-matrix.md`](./compatibility-matrix.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`dependency-impact-map.md`](./dependency-impact-map.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`high-risk-components.md`](./high-risk-components.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
