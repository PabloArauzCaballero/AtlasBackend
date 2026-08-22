<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/database

## Por qué existe

- **Negocio:** esta carpeta previene regresiones que afectarían los contratos críticos del backend.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; valida componentes aislados.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`domain-schemas.spec.ts`](./domain-schemas.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`ops-grants-cover-schemas.spec.ts`](./ops-grants-cover-schemas.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`postgres-error.spec.ts`](./postgres-error.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`provisioning-guard.spec.ts`](./provisioning-guard.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`read-query.service.spec.ts`](./read-query.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`seed-profile.spec.ts`](./seed-profile.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`startup-seed.service.spec.ts`](./startup-seed.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
