<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/sessions

## Por qué existe

- **Negocio:** esta carpeta mantiene continuidad, seguridad y señales de uso durante la interacción del cliente.
- **Sistema:** esta carpeta orquesta inicio, heartbeat, cierre, ubicación, dispositivo y auditoría del ciclo de sesión.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`sessions.controller.ts`](./sessions.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`sessions.dtos.ts`](./sessions.dtos.ts) | DTOs: contrato estable de salida sin filtrar modelos de persistencia. |
| [`sessions.mapper.ts`](./sessions.mapper.ts) | Mapper: transforma modelos internos a contratos de transporte. |
| [`sessions.module.ts`](./sessions.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`sessions.repository.ts`](./sessions.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`sessions.schemas.ts`](./sessions.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`sessions.service.ts`](./sessions.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Subcarpetas

- [`application/`](./application/README.md)
- [`repositories/`](./repositories/README.md)

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
