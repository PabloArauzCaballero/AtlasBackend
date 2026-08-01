<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/external-data

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`adapters-production-guard.spec.ts`](./adapters-production-guard.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`banking-generic.adapter.spec.ts`](./banking-generic.adapter.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`banking-qr.service.spec.ts`](./banking-qr.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`banking-qr.util.spec.ts`](./banking-qr.util.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`digital-trust-generic.adapter.spec.ts`](./digital-trust-generic.adapter.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`external-data-admin-roles.spec.ts`](./external-data-admin-roles.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`external-data-controller.util.spec.ts`](./external-data-controller.util.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`external-data-decision.service.spec.ts`](./external-data-decision.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`external-data-evidence.service.spec.ts`](./external-data-evidence.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`external-data-execution.service.spec.ts`](./external-data-execution.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`external-data-governance.service.spec.ts`](./external-data-governance.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`external-data-policy.util.spec.ts`](./external-data-policy.util.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`external-data.controller.spec.ts`](./external-data.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`external-data.repository.spec.ts`](./external-data.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`external-data.service.spec.ts`](./external-data.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`external-provider-boot-requirements.spec.ts`](./external-provider-boot-requirements.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`external-provider-convenience.service.spec.ts`](./external-provider-convenience.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`external-provider-registry.service.spec.ts`](./external-provider-registry.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`facebook-meta.adapter.spec.ts`](./facebook-meta.adapter.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`infocenter.adapter.spec.ts`](./infocenter.adapter.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`kyc-bureau.controller.spec.ts`](./kyc-bureau.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`mock-http.util.spec.ts`](./mock-http.util.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`payments-telco.controller.spec.ts`](./payments-telco.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`qr-generic.adapter.spec.ts`](./qr-generic.adapter.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`segip.adapter.spec.ts`](./segip.adapter.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`social-trust.controller.spec.ts`](./social-trust.controller.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`telco-generic.adapter.spec.ts`](./telco-generic.adapter.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`whatsapp.adapter.spec.ts`](./whatsapp.adapter.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
