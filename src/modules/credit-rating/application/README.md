<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/credit-rating/application

## Por qué existe

- **Negocio:** esta carpeta sostiene una parte mantenida del backend Atlas.
- **Sistema:** esta carpeta agrupa artefactos relacionados bajo un límite navegable.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`debt-rating.service.ts`](./debt-rating.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`rating-policy.service.ts`](./rating-policy.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`rating-query.service.ts`](./rating-query.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`rating-scale-catalog.ts`](./rating-scale-catalog.ts) | Artefacto de soporte específico de esta carpeta. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
