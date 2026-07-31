<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/common

## Por qué existe

- **Negocio:** esta carpeta previene regresiones que afectarían los contratos críticos del backend.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; valida componentes aislados.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`id.util.spec.ts`](./id.util.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`number.util.spec.ts`](./number.util.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Subcarpetas

- [`filters/`](./filters/README.md)
- [`guards/`](./guards/README.md)
- [`interceptors/`](./interceptors/README.md)
- [`lifecycle/`](./lifecycle/README.md)
- [`logging/`](./logging/README.md)
- [`throttler/`](./throttler/README.md)
- [`utils/`](./utils/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
