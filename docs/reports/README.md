<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/reports

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta reports como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`baseline.md`](./baseline.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`documentation-gap-analysis.md`](./documentation-gap-analysis.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`final-validation.md`](./final-validation.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`graphify-audit.md`](./graphify-audit.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`index.md`](./index.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`production-readiness.md`](./production-readiness.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
