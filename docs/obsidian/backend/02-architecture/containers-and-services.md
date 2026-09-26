---
title: "Contenedores y servicios"
type: "architecture"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - architecture
aliases: []
related: []
---
# Contenedores y servicios

Resumen operativo. La vista formal está en [[02-architecture/views/c4-container]].

| Servicio | Imagen | Rol | Puerto | Estado |
|---|---|---|---|---|
| `migrate` | `atlas-backend` | Aplica migraciones y termina | — | Efímero |
| `api` | `atlas-backend` | `APP_ROLE=api` | 3005 | Sin estado |
| `worker` | `atlas-backend` | `APP_ROLE=worker` | 3006 | Sin estado, con líder |
| `postgres` | PostgreSQL | Fuente de verdad | 5432 | Con estado |
| `redis` | Redis | Coordinación y límites | 6379 | Con estado efímero |
| `mongo` | MongoDB | Logs | 27017 | Con estado |

En `docker-compose.prod.yml` solo están los tres de Atlas: los almacenes son servicios gestionados externos.

## Volúmenes

`atlas-api-logs` y `atlas-worker-logs` separados por rol, para que los logs de ambos procesos no se mezclen en el mismo archivo. En dev, además, `atlas-postgres-data`, `atlas-redis-data` y `atlas-mongo-data`.

## Relaciones

- [[02-architecture/views/c4-container]] · [[10-operations/deployment]] · [[02-architecture/components]]
