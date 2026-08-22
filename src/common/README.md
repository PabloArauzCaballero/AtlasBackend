<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/common

## Por qué existe

- **Negocio:** esta carpeta sostiene una parte mantenida del backend Atlas.
- **Sistema:** esta carpeta agrupa artefactos relacionados bajo un límite navegable.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`common-auth.module.ts`](./common-auth.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |

## Subcarpetas

- [`bootstrap/`](./bootstrap/README.md)
- [`database/`](./database/README.md)
- [`decorators/`](./decorators/README.md)
- [`files/`](./files/README.md)
- [`filters/`](./filters/README.md)
- [`guards/`](./guards/README.md)
- [`interceptors/`](./interceptors/README.md)
- [`lifecycle/`](./lifecycle/README.md)
- [`logging/`](./logging/README.md)
- [`middleware/`](./middleware/README.md)
- [`observability/`](./observability/README.md)
- [`openapi/`](./openapi/README.md)
- [`pipes/`](./pipes/README.md)
- [`redis/`](./redis/README.md)
- [`resilience/`](./resilience/README.md)
- [`services/`](./services/README.md)
- [`storage/`](./storage/README.md)
- [`throttler/`](./throttler/README.md)
- [`types/`](./types/README.md)
- [`utils/`](./utils/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
