---
title: "log-sync"
type: "domain"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "log-sync"
module: "LogSyncModule"
tags:
  - "backend"
  - "domain"
  - "module/log-sync"
source_files:
  - "src/modules/log-sync/log-sync.module.ts"
  - "src/modules/log-sync/mongo-logs.controller.ts"
endpoints:
  - "GET /systems/logs/mongo"
dependencies: []
---
# Módulo `log-sync`

Esta pieza preserva evidencia operativa suficiente para diagnosticar incidentes con retención limitada.

**Papel técnico:** sincroniza logs redactados hacia MongoDB, aplica TTL y ofrece consultas administrativas.

| | |
|---|---|
| Clase | `LogSyncModule` |
| Archivos | 6 |
| Controllers | 1 |
| Rutas HTTP | 1 |
| Modelos usados | 0 |
| Esquemas de datos | — |

## Entradas

1 rutas HTTP. Contrato completo en [[04-api/index]].

| Método | Ruta | Auth | Roles |
|---|---|---|---|
| `GET` | `/systems/logs/mongo` | 🔒 | — |

## Salidas y efectos

`INFERIDO` — no registra modelos propios; opera sobre datos de otros módulos o sobre infraestructura.

## Dependencias

**Depende de:** ningún otro módulo de negocio — es un módulo hoja.

**Del que dependen:** ningún módulo de negocio lo importa.

**Exporta:** nada — su capacidad no es accesible desde otros módulos.

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | `mongo-logs.controller.ts` |
| Services | `log-sync.service.ts`, `mongo-logs-query.service.ts` |
| Repositories | — |
| Esquemas Zod | `mongo-logs.schemas.ts` |
| Mappers | — |

## Autorización

Sin rutas HTTP: no aplica autorización de transporte.


## Pruebas

3 archivo(s) de test:

- `test/unit/log-sync/log-sync.service.spec.ts`
- `test/unit/log-sync/mongo-logs-query.service.spec.ts`
- `test/unit/log-sync/mongo-logs.controller.spec.ts`

## Referencias al código

- Módulo: [`src/modules/log-sync/log-sync.module.ts`](../../../../../src/modules/log-sync/log-sync.module.ts)
- Controller `MongoLogsController`: [`src/modules/log-sync/mongo-logs.controller.ts`](../../../../../src/modules/log-sync/mongo-logs.controller.ts)

## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
