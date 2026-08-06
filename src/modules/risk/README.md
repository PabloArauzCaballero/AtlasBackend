<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/risk

## Por qué existe

- **Negocio:** esta carpeta produce una recomendación explicable para reducir pérdida crediticia y trato inconsistente.
- **Sistema:** esta carpeta calcula evaluaciones versionadas, contribuciones y reglas disparadas sin presentarlas como un modelo validado.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`risk-heuristic-v0.constants.ts`](./risk-heuristic-v0.constants.ts) | Artefacto de soporte específico de esta carpeta. |
| [`risk.controller.ts`](./risk.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`risk.dtos.ts`](./risk.dtos.ts) | DTOs: contrato estable de salida sin filtrar modelos de persistencia. |
| [`risk.mapper.ts`](./risk.mapper.ts) | Mapper: transforma modelos internos a contratos de transporte. |
| [`risk.module.ts`](./risk.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`risk.repository.ts`](./risk.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`risk.schemas.ts`](./risk.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`risk.service.ts`](./risk.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Subcarpetas

- [`application/`](./application/README.md)
- [`repositories/`](./repositories/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
