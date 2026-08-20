<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/credit/application

## Por qué existe

- **Negocio:** esta carpeta materializa la oferta y solicitud de crédito solo para clientes habilitados y con decisiones explicables.
- **Sistema:** esta carpeta coordina productos, solicitudes, transiciones y eventos inmutables del ciclo de crédito.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`credit-application.service.ts`](./credit-application.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`credit-business-acceptance.service.ts`](./credit-business-acceptance.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`credit-decision.service.ts`](./credit-decision.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`credit-product-eligibility.ts`](./credit-product-eligibility.ts) | Artefacto de soporte específico de esta carpeta. |
| [`credit-product.service.ts`](./credit-product.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`credit-underwriting.service.ts`](./credit-underwriting.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
