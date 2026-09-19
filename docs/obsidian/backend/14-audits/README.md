<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/obsidian/backend/14-audits

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta 14-audits como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`contradictions.md`](./contradictions.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`documentation-coverage.md`](./documentation-coverage.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`risks-register.md`](./risks-register.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`technical-debt.md`](./technical-debt.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
