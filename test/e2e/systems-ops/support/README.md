<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/e2e/systems-ops/support

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
- **Sistema:** esta carpeta contiene pruebas HTTP integradas y soporte reproducible; descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`systems-ops-test-app.ts`](./systems-ops-test-app.ts) | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
