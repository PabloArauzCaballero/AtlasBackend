---
title: "Runbooks"
type: "runbook"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - operations
  - runbook
aliases: []
related: []
---
# Runbooks

Procedimientos para incidentes concretos.

| Runbook | Síntoma |
|---|---|
| [[10-operations/runbooks/worker-detenido]] | El trabajo de fondo no avanza |
| [[10-operations/runbooks/readiness-en-503]] | Las instancias salen del balanceador |
| [[10-operations/runbooks/outbox-acumulado]] | Los eventos no se publican |
| [[10-operations/runbooks/pool-agotado]] | Latencia alta sin consultas lentas |
| [[10-operations/runbooks/proveedor-externo-caido]] | Falla el enriquecimiento o la verificación |

## Antes de cualquier diagnóstico

```bash
curl -s http://<host>:3005/health            # versión, commit, uptime
curl -s http://<host>:3005/health/readiness  # dependencias
curl -s http://<host>:3006/health/readiness  # worker
```

`/health` nunca falla por sí mismo: siempre responde, con `status: ok` o `degraded`. Sirve para saber **qué versión** está desplegada.

## Los tres sitios donde mirar

| Pregunta | Dónde |
|---|---|
| ¿Qué pasó en este request? | Logs por `requestId` |
| ¿Cuándo corrió este job y qué hizo? | `platform_ops.system_job_runs` |
| ¿Quién hizo qué? | Esquema `audit` y `customer_action_logs` |

> [!warning] No busques el SQL en los logs
> No está, a propósito: Sequelize inlinea valores y filtraría PII. Tienes el mensaje del driver y el SQLSTATE. Ver [[09-observability/logging]].

## Relaciones

- [[09-observability/observability-overview]] · [[10-operations/deployment]] · [[12-development/troubleshooting]]
