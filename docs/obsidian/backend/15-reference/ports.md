---
title: "Puertos"
type: "reference"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - reference
aliases: []
related: []
---
# Puertos

| Puerto | Variable | Servicio | Expuesto |
|---|---|---|---|
| 3005 | `APP_PORT` | API HTTP + `/metrics` | Sí, tras el balanceador |
| 3006 | `WORKER_PROBE_PORT` | Sonda del worker + `/metrics` | **No** debería salir a Internet |
| 5432 | `DB_PORT` | PostgreSQL | Red interna |
| 6379 | — | Redis | Red interna |
| 27017 | — | MongoDB | Red interna |

`EXPOSE 3005 3006` en el `Dockerfile`.

> [!info] Por qué el worker usa otro puerto
> En un despliegue de una sola máquina ambos procesos conviven, y así el manifiesto puede publicar uno sin publicar el otro.

> [!warning] Ni `/metrics` ni la sonda llevan autenticación de aplicación
> Su protección depende del aislamiento de red, que se decide en el despliegue y **no es verificable desde el código**. Ver [[14-audits/risks-register|SEC-004]].

## Contradicción documental

`README.md` menciona el puerto 3000; el valor real es **3005**. Ver [[14-audits/contradictions|C-002]].

## Relaciones

- [[10-operations/deployment]] · [[02-architecture/trust-boundaries]]
