<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/workflow-catalog

## Por qué existe

- **Negocio:** esta carpeta publica el árbol de endpoints del proceso estándar para que cliente y portal no dupliquen su lógica.
- **Sistema:** esta carpeta expone el catálogo versionado de flujos, etapas, pasos, dependencias y transiciones.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`workflow-bundle-filter.util.ts`](./workflow-bundle-filter.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`workflow-catalog.constants.ts`](./workflow-catalog.constants.ts) | Artefacto de soporte específico de esta carpeta. |
| [`workflow-catalog.controller.ts`](./workflow-catalog.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`workflow-catalog.dtos.ts`](./workflow-catalog.dtos.ts) | DTOs: contrato estable de salida sin filtrar modelos de persistencia. |
| [`workflow-catalog.mapper.ts`](./workflow-catalog.mapper.ts) | Mapper: transforma modelos internos a contratos de transporte. |
| [`workflow-catalog.module.ts`](./workflow-catalog.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`workflow-catalog.repository.ts`](./workflow-catalog.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`workflow-catalog.schemas.ts`](./workflow-catalog.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`workflow-catalog.service.ts`](./workflow-catalog.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`workflow-graph.builder.ts`](./workflow-graph.builder.ts) | Artefacto de soporte específico de esta carpeta. |
| [`workflow-operations.controller.ts`](./workflow-operations.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`workflow-progress.controller.ts`](./workflow-progress.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`workflow-stage-order.util.ts`](./workflow-stage-order.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |

## Subcarpetas

- [`application/`](./application/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
