<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/obsidian/backend/08-security

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta 08-security como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`abuse-cases.md`](./abuse-cases.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`authentication.md`](./authentication.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`authorization.md`](./authorization.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`data-protection.md`](./data-protection.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`secrets-management.md`](./secrets-management.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`security-overview.md`](./security-overview.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`threat-model.md`](./threat-model.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
