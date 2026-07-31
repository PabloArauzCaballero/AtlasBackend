<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/e2e/workflow-catalog

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
- **Sistema:** esta carpeta contiene pruebas HTTP integradas y soporte reproducible; expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`workflow-catalog.spec.ts`](./workflow-catalog.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`workflow-progress-and-operations.spec.ts`](./workflow-progress-and-operations.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Subcarpetas

- [`support/`](./support/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
