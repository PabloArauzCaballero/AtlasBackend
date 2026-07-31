<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/credit

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que materializa la oferta y solicitud de crédito solo para clientes habilitados y con decisiones explicables.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; coordina productos, solicitudes, transiciones y eventos inmutables del ciclo de crédito.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`credit-application.service.spec.ts`](./credit-application.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`credit-product-and-decision.service.spec.ts`](./credit-product-and-decision.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`credit.controllers.spec.ts`](./credit.controllers.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`credit.repository.spec.ts`](./credit.repository.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
