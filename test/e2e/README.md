<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/e2e

## Por qué existe

- **Negocio:** esta carpeta previene regresiones que afectarían los contratos críticos del backend.
- **Sistema:** esta carpeta contiene pruebas HTTP integradas y soporte reproducible; valida componentes aislados.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| — | Esta carpeta funciona como agrupador; su contenido está en subcarpetas. |

## Subcarpetas

- [`catalog-management/`](./catalog-management/README.md)
- [`notifications/`](./notifications/README.md)
- [`systems-ops/`](./systems-ops/README.md)
- [`workflow-catalog/`](./workflow-catalog/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
