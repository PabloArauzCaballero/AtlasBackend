<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# src/modules/runtime-hardening

## Por qué existe

- **Negocio:** esta carpeta evita duplicados y pérdida de efectos ante reintentos, concurrencia o fallos parciales.
- **Sistema:** esta carpeta centraliza idempotencia y outbox como garantías transversales del runtime HTTP.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`idempotency.interceptor.ts`](./idempotency.interceptor.ts) | Interceptor: aplica una política transversal al ciclo HTTP. |
| [`outbox.interceptor.ts`](./outbox.interceptor.ts) | Interceptor: aplica una política transversal al ciclo HTTP. |
| [`runtime-hardening.module.ts`](./runtime-hardening.module.ts) | Módulo NestJS: declara el límite de inyección y sus dependencias. |
| [`runtime-hardening.service.ts`](./runtime-hardening.service.ts) | Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
