# ADR-0001: Outbox transaccional en PostgreSQL (no cola dedicada)

- **Estado:** Aceptado
- **Fecha:** 2026-07-16
- **Decisores:** equipo backend
- **Relacionado:** [`outbox-events.model.ts`](../../src/database/models/outbox-events.model.ts), [`outbox.interceptor.ts`](../../src/modules/runtime-hardening/outbox.interceptor.ts), plan 10/10 Fase 5.3

## Contexto

AtlasBackend necesita publicar eventos de dominio (notificaciones, side-effects,
integraciones) con garantía de entrega **at-least-once** y sin perder eventos si el
proceso muere entre "commit de la transacción de negocio" y "publicación del evento".
El patrón clásico para esto es el **transactional outbox**: el evento se escribe en la
misma transacción de base de datos que el cambio de negocio, y un despachador lo
entrega después.

La pregunta de arquitectura es **dónde vive el outbox**: en la propia PostgreSQL (una
tabla) o en un sistema de colas dedicado (SQS, RabbitMQ, BullMQ/Redis).

## Decisión

El outbox vive en **una tabla de PostgreSQL** (`outbox_events`), escrita dentro de la
misma transacción que el cambio de negocio y drenada por un despachador. No se
introduce un broker de colas dedicado en este momento.

## Alternativas consideradas

- **SQS / broker gestionado** — añade una dependencia de infraestructura, costo fijo y
  un segundo sistema con su propia semántica de fallo y observabilidad, para un volumen
  que hoy PostgreSQL absorbe sin esfuerzo. La atomicidad "negocio + evento" exigiría de
  todas formas un outbox local para evitar el problema dual-write. Descartada por costo
  y complejidad prematuros.
- **BullMQ sobre Redis** — Redis hoy solo es obligatorio en producción (ver
  [ADR-0002](0002-redis-solo-en-produccion.md)) y como caché de rate limiting, no como
  almacén durable. Convertirlo en el sustrato de la cola de eventos elevaría su
  criticidad y requisitos de persistencia. Descartada por ahora.

## Consecuencias

- **Positivas:** atomicidad real entre el cambio de negocio y el evento (una sola
  transacción); cero infraestructura nueva; el outbox es inspeccionable con SQL normal;
  backups y point-in-time recovery lo cubren gratis.
- **Negativas / costos asumidos:** el despacho compite por conexiones del mismo pool de
  Postgres; el throughput máximo está acotado por la base de datos; no hay aislamiento
  de workers "gratis" como en un broker dedicado.
- **Condición de revisión (trigger):** migrar a SQS/BullMQ **solo** cuando se mida uno
  de estos SLO disparadores, no antes:
  - latencia p95 de despacho de evento > umbral acordado de forma sostenida, **o**
  - backlog de `outbox_events` pendientes que no drena dentro del intervalo objetivo, **o**
  - necesidad real de aislar workers de despacho de la carga transaccional OLTP.
  Cuando se active, primero se instrumenta la métrica de backlog/latencia (plan Fase
  3.4) para tener el número que justifica la migración.
