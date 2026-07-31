<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/claude

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta claude como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`current-configuration-audit.md`](./current-configuration-audit.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`environment-inventory.md`](./environment-inventory.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`installation-report.md`](./installation-report.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`plugin-selection-matrix.md`](./plugin-selection-matrix.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`skills-traceability.md`](./skills-traceability.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`usage-guide.md`](./usage-guide.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`validation-report.md`](./validation-report.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
