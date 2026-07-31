<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/customers

## Por qué existe

- **Negocio:** esta carpeta mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
- **Sistema:** esta carpeta expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`customer-eligibility.constants.ts`](./customer-eligibility.constants.ts) | Artefacto de soporte específico de esta carpeta. |
| [`customer-eligibility.controller.ts`](./customer-eligibility.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`customer-eligibility.schemas.ts`](./customer-eligibility.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`customer-lifecycle.constants.ts`](./customer-lifecycle.constants.ts) | Artefacto de soporte específico de esta carpeta. |
| [`customers.controller.ts`](./customers.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`customers.dtos.ts`](./customers.dtos.ts) | DTOs: contrato estable de salida sin filtrar modelos de persistencia. |
| [`customers.mapper.ts`](./customers.mapper.ts) | Mapper: transforma modelos internos a contratos de transporte. |
| [`customers.module.ts`](./customers.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`customers.repository.ts`](./customers.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`customers.schemas.ts`](./customers.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`customers.service.ts`](./customers.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Subcarpetas

- [`application/`](./application/README.md)
- [`repositories/`](./repositories/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
