<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/operations

## Por qué existe

- **Negocio:** esta carpeta permite resolver excepciones y revisiones manuales con responsabilidad y trazabilidad.
- **Sistema:** esta carpeta gestiona colas y decisiones operativas mediante servicios transaccionales y repositorios aislados.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`operations.controller.ts`](./operations.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`operations.dtos.ts`](./operations.dtos.ts) | DTOs: contrato estable de salida sin filtrar modelos de persistencia. |
| [`operations.mapper.ts`](./operations.mapper.ts) | Mapper: transforma modelos internos a contratos de transporte. |
| [`operations.module.ts`](./operations.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`operations.repository.ts`](./operations.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`operations.schemas.ts`](./operations.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`operations.service.ts`](./operations.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
