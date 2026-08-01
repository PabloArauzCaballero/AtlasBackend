<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/openapi

## Por qué existe

- **Negocio:** esta carpeta previene regresiones que afectarían los contratos críticos del backend.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; valida componentes aislados.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`auth-openapi.spec.ts`](./auth-openapi.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`catalog-management-openapi.spec.ts`](./catalog-management-openapi.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`external-data-openapi.spec.ts`](./external-data-openapi.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`final-block-openapi.spec.ts`](./final-block-openapi.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`normalize-contract.spec.ts`](./normalize-contract.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`sessions-openapi.spec.ts`](./sessions-openapi.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`systems-ops-openapi.spec.ts`](./systems-ops-openapi.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`zod-to-schema.util.spec.ts`](./zod-to-schema.util.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
