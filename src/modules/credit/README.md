<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/credit

## Por qué existe

- **Negocio:** esta carpeta materializa la oferta y solicitud de crédito solo para clientes habilitados y con decisiones explicables.
- **Sistema:** esta carpeta coordina productos, solicitudes, transiciones y eventos inmutables del ciclo de crédito.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`credit-line.mapper.ts`](./credit-line.mapper.ts) | Mapper: transforma modelos internos a contratos de transporte. |
| [`credit-operations.controller.ts`](./credit-operations.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`credit.controller.ts`](./credit.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`credit.module.ts`](./credit.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`credit.repository.ts`](./credit.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`credit.schemas.ts`](./credit.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`merchant-credit.controller.ts`](./merchant-credit.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |

## Subcarpetas

- [`application/`](./application/README.md)
- [`domain/`](./domain/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
