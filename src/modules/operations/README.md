<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/operations

## Por qué existe

- **Negocio:** esta carpeta permite resolver excepciones y revisiones manuales con responsabilidad y trazabilidad.
- **Sistema:** esta carpeta gestiona colas y decisiones operativas mediante servicios transaccionales y repositorios aislados.

## Contenido

| Documento o código                                                                     | Responsabilidad                                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`customer-investigation.repository.ts`](./customer-investigation.repository.ts)       | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`customer-observation.repository.ts`](./customer-observation.repository.ts)           | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`manual-review-case.repository.ts`](./manual-review-case.repository.ts)               | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`manual-review-decision-guards.ts`](./manual-review-decision-guards.ts)               | Artefacto de soporte específico de esta carpeta.                               |
| [`manual-review-decision.service.ts`](./manual-review-decision.service.ts)             | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`operations-audit.repository.ts`](./operations-audit.repository.ts)                   | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`operations-investigation.service.ts`](./operations-investigation.service.ts)         | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`operations-queue.repository.ts`](./operations-queue.repository.ts)                   | Puerto de persistencia: encapsula consultas, locks y escrituras.               |
| [`operations-queue.where.ts`](./operations-queue.where.ts)                             | Artefacto de soporte específico de esta carpeta.                               |
| [`operations-work-queue.service.ts`](./operations-work-queue.service.ts)               | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |
| [`operations.controller.ts`](./operations.controller.ts)                               | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`operations.dtos.ts`](./operations.dtos.ts)                                           | DTOs: contrato estable de salida sin filtrar modelos de persistencia.          |
| [`operations.mapper.ts`](./operations.mapper.ts)                                       | Mapper: transforma modelos internos a contratos de transporte.                 |
| [`operations.module.ts`](./operations.module.ts)                                       | Módulo NestJS: declara el límite de inyección y sus dependencias.              |
| [`operations.schemas.ts`](./operations.schemas.ts)                                     | Esquemas Zod: validan entradas y parámetros en el borde del sistema.           |
| [`pending-contact-verification.service.ts`](./pending-contact-verification.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.      |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
