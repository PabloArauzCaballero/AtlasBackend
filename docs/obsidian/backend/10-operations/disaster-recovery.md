---
title: "Recuperación ante desastres"
type: "runbook"
status: "draft"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - operations
aliases: []
related: []
---
# Recuperación ante desastres

> [!question] Pendiente — no definido en el repositorio
> No hay plan de recuperación, RPO ni RTO documentados. Esta nota recoge lo que el código **sí** garantiza y lo que queda por definir.

## Lo que el código garantiza

| Capacidad | Cómo |
|---|---|
| Reconstruir el esquema | 61 migraciones idempotentes (`yarn db:migration:up`) |
| Sembrar datos maestros | `yarn db:seed:prod`, idempotente y verificable |
| Reproducir el artefacto | Imagen determinista desde CI |
| Reanudar el trabajo pendiente | Los jobs retoman `pending`; `reclaim_stuck_events` rescata lo atascado |
| Verificar qué versión corre | `GET /health` devuelve versión y commit |

**Un despliegue vacío se reconstruye entero desde el repositorio.** Lo que no se reconstruye son los datos de negocio.

## Puntos únicos de fallo

| Componente | Impacto | Mitigación existente |
|---|---|---|
| PostgreSQL primario | **Total** — readiness 503 en todo el despliegue | Ninguna en el código |
| Redis | Alto en producción — rate limit y liderazgo | Ninguna en el código |
| Clave maestra de PII | **Total sobre la PII** — datos ilegibles | `providerId` embebido permite convivencia de proveedores |
| S3 | Medio | — |

## Escenarios a documentar

- [ ] Pérdida del primario de PostgreSQL
- [ ] Pérdida de Redis
- [ ] Pérdida de la clave de cifrado
- [ ] Corrupción de datos por despliegue defectuoso
- [ ] Pérdida de una región

## Orden de recuperación

`INFERIDO` a partir de las dependencias del código:

1. PostgreSQL (y su capacidad de descifrar → clave KMS)
2. Migraciones al día
3. Redis
4. `api` y `worker`
5. Verificación: readiness + smokes
6. Drenar el outbox acumulado

## Relaciones

- [[05-data/backups-and-restore]] · [[10-operations/runbooks/index]] · [[02-architecture/architecture-risks]]
