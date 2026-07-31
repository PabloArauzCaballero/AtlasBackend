<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/customer-telemetry

## Por qué existe

- **Negocio:** esta carpeta captura señales de comportamiento y dispositivo necesarias para prevención de fraude y mejora de conversión.
- **Sistema:** esta carpeta valida e ingiere lotes de telemetría con límites, redacción y escritura transaccional.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`customer-telemetry.controller.ts`](./customer-telemetry.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`customer-telemetry.module.ts`](./customer-telemetry.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`customer-telemetry.repository.ts`](./customer-telemetry.repository.ts) | Puerto de persistencia: encapsula consultas, locks y escrituras. |
| [`customer-telemetry.schemas.ts`](./customer-telemetry.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |
| [`customer-telemetry.service.ts`](./customer-telemetry.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
