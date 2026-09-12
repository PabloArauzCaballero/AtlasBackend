---
title: "Matriz de comunicaciones"
type: "architecture"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - architecture
aliases: []
related: []
---
# Matriz de comunicaciones

| Origen | Destino | Protocolo | Contrato | Síncrono | Auth | Timeout | Reintento |
|---|---|---|---|---|---|---|---|
| App cliente | `api` | HTTPS | OpenAPI | Sí | JWT | `RequestTimeout` | Cliente |
| Portal interno | `api` | HTTPS | OpenAPI | Sí | JWT | `RequestTimeout` | Cliente |
| Prometheus | `api` / `worker` | HTTP | Formato Prometheus | Sí | **ninguna** | — | Scrape periódico |
| Orquestador | `api` / `worker` | HTTP | Sondas | Sí | ninguna | Por probe | Configurable |
| `api` | PostgreSQL | TCP/PostgreSQL | SQL | Sí | Usuario runtime | `DB_POOL_ACQUIRE_MS` | Pool |
| `api` | Redis | RESP | Comandos | Sí | `REDIS_URL` | Por operación | ioredis |
| `api` | S3 | HTTPS | API S3 | Sí | Credenciales AWS | Adaptador | Resiliente |
| `api` | KMS | HTTPS | API KMS | Sí | Credenciales AWS | SDK | SDK |
| `api` | Proveedores externos | HTTPS | Por adaptador | Sí | Por proveedor | Configurable | **Circuit breaker + reintentos** |
| `api` | `worker` | **outbox en PostgreSQL** | `outbox_events` | **No** | — | — | Job + rescate |
| `worker` | PostgreSQL | TCP/PostgreSQL | SQL | Sí | Usuario runtime | Pool | Pool |
| `worker` | Redis | RESP | Liderazgo | Sí | `REDIS_URL` | Por operación | ioredis |
| `api`/`worker` | MongoDB | TCP/Mongo | Documentos de log | No (fire-and-forget) | Cadena de conexión | — | Degrada |

## Lo que no existe

- **API ↔ worker directo.** Solo se comunican por la tabla de outbox.
- **Broker de mensajería.**
- **Descubrimiento de servicios.** Todo por configuración.
- **gRPC, GraphQL, WebSocket.**

## Único canal asíncrono

`api` → `outbox_events` → `worker`. Es lo que permite desplegar, reiniciar y escalar ambos procesos sin coordinación entre ellos. Ver [[07-async-processing/events]].

## Relaciones

- [[02-architecture/dependency-map]] · [[02-architecture/views/c4-container]] · [[06-integrations/index]]
