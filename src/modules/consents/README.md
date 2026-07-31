<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/consents

## Por qué existe

- **Negocio:** esta carpeta demuestra qué tratamiento de datos aceptó o rechazó cada cliente y bajo qué versión legal.
- **Sistema:** esta carpeta registra decisiones y eventos de consentimiento con separación entre DTO, reglas y persistencia.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`consents.controller.ts`](./consents.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`consents.dtos.ts`](./consents.dtos.ts) | DTOs: contrato estable de salida sin filtrar modelos de persistencia. |
| [`consents.mapper.ts`](./consents.mapper.ts) | Mapper: transforma modelos internos a contratos de transporte. |
| [`consents.module.ts`](./consents.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`consents.repository.ts`](./consents.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`consents.schemas.ts`](./consents.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`consents.service.ts`](./consents.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
