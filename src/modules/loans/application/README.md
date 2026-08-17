<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/loans/application

## Por qué existe

- **Negocio:** esta carpeta sostiene una parte mantenida del backend Atlas.
- **Sistema:** esta carpeta agrupa artefactos relacionados bajo un límite navegable.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`loan-delinquency.service.ts`](./loan-delinquency.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`loan-disbursement.service.ts`](./loan-disbursement.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`loan-payment.service.ts`](./loan-payment.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`loan-query.service.ts`](./loan-query.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`loan-writeoff.service.ts`](./loan-writeoff.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
