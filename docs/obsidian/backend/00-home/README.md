<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/obsidian/backend/00-home

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta 00-home como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`executive-summary.md`](./executive-summary.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`index.md`](./index.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`navigation-map.md`](./navigation-map.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`quick-start.md`](./quick-start.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
