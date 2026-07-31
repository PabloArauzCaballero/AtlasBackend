<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/log-sync

## Por qué existe

- **Negocio:** esta carpeta preserva evidencia operativa suficiente para diagnosticar incidentes con retención limitada.
- **Sistema:** esta carpeta sincroniza logs redactados hacia MongoDB, aplica TTL y ofrece consultas administrativas.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`log-sync.module.ts`](./log-sync.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`log-sync.reader.util.ts`](./log-sync.reader.util.ts) | Utilidad pura o acotada reutilizable dentro de su capa. |
| [`log-sync.service.ts`](./log-sync.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`mongo-logs-query.service.ts`](./mongo-logs-query.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`mongo-logs.controller.ts`](./mongo-logs.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`mongo-logs.schemas.ts`](./mongo-logs.schemas.ts) | Esquemas Zod: validan entradas y parámetros en el borde del sistema. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
