<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/audit

## Por qué existe

- **Negocio:** esta carpeta aporta trazabilidad verificable de acciones y cambios para investigación, cumplimiento y soporte.
- **Sistema:** esta carpeta consolida consultas y persistencia de eventos de auditoría sin exponer modelos ORM al transporte.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`audit.controller.ts`](./audit.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`audit.module.ts`](./audit.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`audit.repository.ts`](./audit.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`audit.schemas.ts`](./audit.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`audit.service.ts`](./audit.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`http-action-log.service.ts`](./http-action-log.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
