<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/e2e/systems-ops

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
- **Sistema:** esta carpeta contiene pruebas HTTP integradas y soporte reproducible; descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`action-log.spec.ts`](./action-log.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`catalog.spec.ts`](./catalog.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`review.spec.ts`](./review.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`stress.spec.ts`](./stress.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`test-suites.spec.ts`](./test-suites.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Subcarpetas

- [`support/`](./support/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
