<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/external-data/controllers

## Por qué existe

- **Negocio:** esta carpeta incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
- **Sistema:** esta carpeta aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.

## Contenido

| Documento o código                                                                                     | Responsabilidad                                                                |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| [`admin-external-providers-config.controller.ts`](./admin-external-providers-config.controller.ts)     | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`admin-external-providers-reports.controller.ts`](./admin-external-providers-reports.controller.ts)   | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`admin-external-providers-requests.controller.ts`](./admin-external-providers-requests.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`external-data-consents.controller.ts`](./external-data-consents.controller.ts)                       | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`external-data-customer-evidence.controller.ts`](./external-data-customer-evidence.controller.ts)     | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`external-data-requests.controller.ts`](./external-data-requests.controller.ts)                       | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`external-providers-dashboard.controller.ts`](./external-providers-dashboard.controller.ts)           | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`kyc-bureau.controller.ts`](./kyc-bureau.controller.ts)                                               | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`payments-telco.controller.ts`](./payments-telco.controller.ts)                                       | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`provider-auth.controller.ts`](./provider-auth.controller.ts)                                         | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`social-trust.controller.ts`](./social-trust.controller.ts)                                           | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
