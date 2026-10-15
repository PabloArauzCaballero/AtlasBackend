<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/external-data/application

## Por qué existe

- **Negocio:** esta carpeta incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
- **Sistema:** esta carpeta aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.

## Contenido

| Documento o código                                                                       | Responsabilidad                                                           |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`banking-qr.service.ts`](./banking-qr.service.ts)                                       | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`external-consent.service.ts`](./external-consent.service.ts)                           | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`external-cost-policy.mapper.ts`](./external-cost-policy.mapper.ts)                     | Mapper: transforma modelos internos a contratos de transporte.            |
| [`external-data-decision.service.ts`](./external-data-decision.service.ts)               | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`external-data-evidence.service.ts`](./external-data-evidence.service.ts)               | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`external-data-execution.service.ts`](./external-data-execution.service.ts)             | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`external-data-governance.service.ts`](./external-data-governance.service.ts)           | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`external-data-policy.util.ts`](./external-data-policy.util.ts)                         | Utilidad pura o acotada reutilizable dentro de su capa.                   |
| [`external-data-preview.service.ts`](./external-data-preview.service.ts)                 | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`external-provider-call.service.ts`](./external-provider-call.service.ts)               | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`external-provider-convenience.service.ts`](./external-provider-convenience.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`external-provider-dashboard.service.ts`](./external-provider-dashboard.service.ts)     | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`external-provider-readiness.service.ts`](./external-provider-readiness.service.ts)     | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`external-provider-registry.service.ts`](./external-provider-registry.service.ts)       | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`external-provider-reporting.service.ts`](./external-provider-reporting.service.ts)     | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`external-request-approval.ts`](./external-request-approval.ts)                         | Artefacto de soporte específico de esta carpeta.                          |

## Subcarpetas

- [`ports/`](./ports/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
