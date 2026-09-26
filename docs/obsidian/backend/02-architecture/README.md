<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/obsidian/backend/02-architecture

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta 02-architecture como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`architectural-style.md`](./architectural-style.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`architecture-overview.md`](./architecture-overview.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`architecture-risks.md`](./architecture-risks.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`communication-matrix.md`](./communication-matrix.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`components.md`](./components.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`containers-and-services.md`](./containers-and-services.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`critical-sequences.md`](./critical-sequences.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`dependency-map.md`](./dependency-map.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`deployment-topology.md`](./deployment-topology.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`module-boundaries.md`](./module-boundaries.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`runtime-topology.md`](./runtime-topology.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`trust-boundaries.md`](./trust-boundaries.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Subcarpetas

- [`adr/`](./adr/index.md)
- [`views/`](./views/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
