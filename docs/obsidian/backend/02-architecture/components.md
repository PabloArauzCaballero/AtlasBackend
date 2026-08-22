---
title: "Catálogo de componentes"
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
# Catálogo de componentes

| ID | Componente | Tipo | Responsabilidad | Despliegue | Criticidad |
|---|---|---|---|---|---|
| `C-API` | Proceso API | Servicio | Atiende 266 rutas HTTP | `main.js` | Crítica |
| `C-WRK` | Proceso worker | Servicio | 9 jobs de fondo | `worker.js` | Crítica |
| `C-PROBE` | Sonda del worker | Servidor HTTP mínimo | Liveness, readiness, métricas | En `C-WRK` | Alta |
| `C-MIG` | Migrador | Proceso efímero | Aplica el esquema | `migrate.js` | Crítica |
| `C-GUARD` | Cadena de guards | Transversal | JWT → rol → tenant | En `C-API` | Crítica |
| `C-INT` | Cadena de interceptores | Transversal | Métricas, timeout, auditoría, idempotencia, outbox, envoltura | En `C-API` | Crítica |
| `C-FILT` | Filtro de excepciones | Transversal | Modelo de error único | En `C-API` | Alta |
| `C-SEQ` | Sequelize (escritura) | Persistencia | Pool de escritura | Ambos | Crítica |
| `C-READ` | ReadQueryService | Persistencia | Pool y vistas de lectura | Ambos | Media |
| `C-RES` | ResilientAdapterExecutor | Infraestructura | Circuit breaker, reintentos, timeout | Ambos | Alta |
| `C-CRY` | EnvelopeEncryption + KMS | Seguridad | Cifrado de PII | Ambos | Crítica |
| `C-STO` | DocumentStorage + Malware | Infraestructura | Evidencia en S3 | `C-API` | Media |
| `C-SCHED` | RuntimeJobsScheduler | Trabajo de fondo | Liderazgo, reentrada, watchdog | `C-WRK` | Crítica |
| `C-LOG` | AppFileLogger + LogSync | Observabilidad | Log a archivo y sincronía a Mongo | Ambos | Media |
| `C-MET` | MetricsService | Observabilidad | Registro Prometheus | Ambos | Media |
| `C-OTEL` | Tracing bootstrap | Observabilidad | Trazas OTLP (opcional) | Ambos | Baja |
| `C-SHUT` | GracefulShutdownService | Ciclo de vida | Drenado al apagar | Ambos | Alta |

## Componentes de dominio

Los 28 módulos de negocio están catalogados en [[03-domains/index]], cada uno con sus entradas, salidas, dependencias y persistencia.

## Relaciones

- [[02-architecture/views/c4-component]] · [[02-architecture/containers-and-services]] · [[03-domains/index]]
