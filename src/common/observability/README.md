<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/common/observability

## Por qué existe

- **Negocio:** esta carpeta aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
- **Sistema:** esta carpeta provee infraestructura transversal de observability sin introducir reglas de un dominio específico.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`db-pool-metrics.service.ts`](./db-pool-metrics.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`http-metrics.interceptor.ts`](./http-metrics.interceptor.ts) | Interceptor: aplica una política transversal al ciclo HTTP. |
| [`metrics.controller.ts`](./metrics.controller.ts) | Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso. |
| [`metrics.service.ts`](./metrics.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |
| [`observability.config.ts`](./observability.config.ts) | Artefacto de soporte específico de esta carpeta. |
| [`observability.module.ts`](./observability.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
