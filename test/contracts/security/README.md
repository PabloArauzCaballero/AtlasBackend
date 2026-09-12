<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/contracts/security

## Por qué existe

- **Negocio:** esta carpeta previene regresiones que afectarían los contratos críticos del backend.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; valida componentes aislados.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`auth-cookie-csrf.spec.ts`](./auth-cookie-csrf.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`control-plane-isolation.spec.ts`](./control-plane-isolation.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`service-tenant-authorization.spec.ts`](./service-tenant-authorization.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
