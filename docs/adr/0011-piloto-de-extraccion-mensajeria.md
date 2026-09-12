# ADR-0011: Piloto de extracción — Mensajería, sin broker, con escritor único por época

- **Estado:** Propuesto (la activación del piloto exige aprobación humana; este ADR no la sustituye)
- **Fecha:** 2026-09-12
- **Decisores:** equipo backend; producto para las exclusiones
- **Relacionado:** AT-056–AT-062 del plan SOLID/microservicios; `docs/architecture/microservices/pilot-readiness.json`;
  [`messaging-worker.module.ts`](../../src/bootstrap/messaging-worker.module.ts); [`context-ownership.registry.ts`](../../src/platform/ownership/context-ownership.registry.ts)

## Contexto

Tras F0–F8 el monolito es modular: Mensajería tiene entrada pública (`notifications/public`), directorio de destinatarios y
OTP por puerto, modelos propios (`messaging.*`), rol de base propio (`atlas_ctx_messaging`) y consume eventos por el relay v2
con inbox. Es el candidato de extracción con menos acoplamiento de escritura y con un fallo tolerable (un aviso tarde no es
un crédito mal concedido).

## Decisión

1. **Alcance del piloto:** las notificaciones **no críticas** que ya existen (avisos de estado de solicitud, recordatorios,
   difusiones internas). **Excluidos** hasta contrato y aprobación aparte: OTP de verificación de contacto, restablecimiento
   de contraseña y cualquier mensaje con secreto o con plazo legal.
2. **Transporte:** se mantiene el outbox en PostgreSQL con el relay v2 (lease/fencing/inbox). **No** se introduce broker
   (Kafka/RabbitMQ/NATS) para el piloto: la comparación de carga (protocolo AT-054) no se ha ejecutado y adoptar una cola por
   preferencia sería exactamente lo que el plan prohíbe. La base sigue compartida durante la ventana; la separación física es
   posterior al corte (AT-061).
3. **Escritor único:** `platform_ops.context_ownership` nombra al dueño de `messaging` con una época; el relay del monolito y el
   worker del piloto consultan la propiedad antes de reclamar; el corte es una transferencia condicional que sube la época y
   devuelve a `pending` lo en vuelo (probado en `single-writer-cutover.spec.ts`). Volver atrás es otra transferencia.
4. **Datos:** el dueño de `messaging.*` sigue siendo la base compartida; no hay copia mientras el piloto no tenga base propia
   (AT-058 prepara la copia y la lectura sombra).

## Lo que bloquea el GO (ver `pilot-readiness.json`)

- El worker aislado **no puede resolver direcciones de clientes**: `RemoteRecipientDirectoryAdapter` devuelve `unsupported`
  porque no existe contrato HTTP con Clientes. Hasta entonces sólo in-app/push (datos propios) serían entregables.
- El proceso valida la **configuración entera del monolito** (`env.ts`): no se ha aplicado la carga por capacidad (AT-046) a
  cada dependencia de Mensajería.
- Difusiones a usuarios internos leen `iam` (`NotificationBroadcastService`): quedan en el monolito.
- Autorización de despliegue, responsables y criterio de cancelación: **no acordados en este plan**.

## Consecuencias

- Lo que se activa hoy es un proceso que arranca solo, cercado, y un procedimiento de corte ensayado contra PostgreSQL; nada
  cambia para producción hasta que alguien transfiera la propiedad, y esa transferencia está documentada como acto explícito.
- Rollback: transferencia inversa con época nueva; no se deshacen envíos ya aceptados por el proveedor (AT-060).
