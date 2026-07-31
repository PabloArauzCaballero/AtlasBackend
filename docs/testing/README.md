<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# docs/testing

## Por qué existe

- **Negocio:** esta carpeta conserva decisiones y contratos para reducir dependencia de conocimiento tácito.
- **Sistema:** esta carpeta documenta testing como fuente versionada para desarrollo y operación.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`coverage-ratchet.md`](./coverage-ratchet.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`external-providers-test-matrix.md`](./external-providers-test-matrix.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`smoke-results.md`](./smoke-results.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`smoke-tests.md`](./smoke-tests.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`stress-notifications.md`](./stress-notifications.md) | Documento versionado: explica decisiones, contratos o procedimientos. |
| [`validacion-local-windows.md`](./validacion-local-windows.md) | Documento versionado: explica decisiones, contratos o procedimientos. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
