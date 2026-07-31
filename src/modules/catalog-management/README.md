<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/catalog-management

## Por qué existe

- **Negocio:** esta carpeta gobierna los catálogos que convierten datos externos y reglas de riesgo en decisiones consistentes.
- **Sistema:** esta carpeta implementa ingesta, versionado, aprobación, activación y consulta transaccional de catálogos.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`catalog-data-governance.repository.ts`](./catalog-data-governance.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`catalog-definitions.repository.ts`](./catalog-definitions.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`catalog-management.controller.ts`](./catalog-management.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`catalog-management.mapper.ts`](./catalog-management.mapper.ts) | Mapper: transforma modelos internos a contratos de transporte. |
| [`catalog-management.module.ts`](./catalog-management.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`catalog-management.openapi.ts`](./catalog-management.openapi.ts) | Artefacto de soporte específico de esta carpeta. |
| [`catalog-management.repository.ts`](./catalog-management.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`catalog-management.schemas.ts`](./catalog-management.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`catalog-management.service.ts`](./catalog-management.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`catalog-repository.helpers.ts`](./catalog-repository.helpers.ts) | Artefacto de soporte específico de esta carpeta. |
| [`catalog-risk-policy.repository.ts`](./catalog-risk-policy.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |

## Subcarpetas

- [`application/`](./application/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
