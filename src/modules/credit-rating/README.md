<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/credit-rating

## Por qué existe

- **Negocio:** esta carpeta sostiene una parte mantenida del backend Atlas.
- **Sistema:** esta carpeta agrupa artefactos relacionados bajo un límite navegable.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`credit-rating-operations.controller.ts`](./credit-rating-operations.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`credit-rating.controller.ts`](./credit-rating.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`credit-rating.mapper.ts`](./credit-rating.mapper.ts) | Mapper: transforma modelos internos a contratos de transporte. |
| [`credit-rating.module.ts`](./credit-rating.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`credit-rating.repository.ts`](./credit-rating.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`credit-rating.schemas.ts`](./credit-rating.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |

## Subcarpetas

- [`application/`](./application/README.md)
- [`domain/`](./domain/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
