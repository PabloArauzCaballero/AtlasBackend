<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/obsidian/backend/05-data/domains

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta domains como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`audit-schema.md`](./audit-schema.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`case_management-schema.md`](./case_management-schema.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`catalog-schema.md`](./catalog-schema.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`credit-schema.md`](./credit-schema.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`customer-schema.md`](./customer-schema.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`iam-schema.md`](./iam-schema.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`integrations-schema.md`](./integrations-schema.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`messaging-schema.md`](./messaging-schema.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`platform_ops-schema.md`](./platform_ops-schema.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`privacy-schema.md`](./privacy-schema.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`risk-schema.md`](./risk-schema.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`telemetry-schema.md`](./telemetry-schema.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
