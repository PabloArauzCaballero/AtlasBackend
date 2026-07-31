<!-- Generado por scripts/generate-project-documentation.ts. No editar a mano. -->

# test/unit/runtime-hardening

## Por qué existe

- **Negocio:** esta carpeta previene regresiones en una capacidad que evita duplicados y pérdida de efectos ante reintentos, concurrencia o fallos parciales.
- **Sistema:** esta carpeta contiene pruebas unitarias y soporte reproducible; centraliza idempotencia y outbox como garantías transversales del runtime HTTP.

## Contenido

| Documento o código | Responsabilidad |
|---|---|
| [`idempotency.interceptor.spec.ts`](./idempotency.interceptor.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`outbox.interceptor.spec.ts`](./outbox.interceptor.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |
| [`runtime-hardening.service.spec.ts`](./runtime-hardening.service.spec.ts) | Prueba automatizada: fija comportamiento y evita regresiones. |

## Reglas de mantenimiento

- Mantener las reglas de negocio fuera de controladores y adaptadores de infraestructura.
- Validar entradas en el borde, preservar aislamiento por tenant y no registrar secretos ni PII en claro.
- Actualizar pruebas y este inventario con `yarn docs:project` cuando cambie la estructura.
