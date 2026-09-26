<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/integration/bootstrap

## Por qué existe

- **Negocio:** esta carpeta previene regresiones que afectarían los contratos críticos del backend.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; valida componentes aislados.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`api-worker-isolation.spec.ts`](./api-worker-isolation.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`encryption-capability.spec.ts`](./encryption-capability.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
