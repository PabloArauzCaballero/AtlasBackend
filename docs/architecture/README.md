<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/architecture

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta architecture como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`architecture.md`](./architecture.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`background-processing.md`](./background-processing.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`c4-model.md`](./c4-model.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`file-services.md`](./file-services.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`flows.md`](./flows.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`index.md`](./index.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`migration-split-verification.md`](./migration-split-verification.md) | Migración reversible: evoluciona el esquema PostgreSQL en orden. |
| [`module-dependencies.md`](./module-dependencies.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`onboarding-flujo-corregido.md`](./onboarding-flujo-corregido.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`onboarding-habilitacion-credito.md`](./onboarding-habilitacion-credito.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
