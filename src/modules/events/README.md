# EventsModule — Patch 2.0

Este módulo convierte `outbox_events` en el motor central de eventos de negocio de ATLAS.

Reglas principales:

- Los módulos de negocio publican eventos; no envían mensajes directamente.
- Los eventos se guardan primero en PostgreSQL.
- `process-events` procesa eventos pendientes y llama al orquestador de notificaciones.
- `idempotency_key` evita duplicados.
- El worker actual es DB-backed. Redis/BullMQ queda para una fase futura sin cambiar el core.
