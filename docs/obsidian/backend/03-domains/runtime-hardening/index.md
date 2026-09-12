---
title: "runtime-hardening"
type: "domain"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "670e9b2"
domain: "runtime-hardening"
module: "RuntimeHardeningModule"
tags:
  - "backend"
  - "domain"
  - "module/runtime-hardening"
source_files:
  - "src/modules/runtime-hardening/runtime-hardening.module.ts"
endpoints: []
dependencies: []
---
# Módulo `runtime-hardening`

Esta pieza evita duplicados y pérdida de efectos ante reintentos, concurrencia o fallos parciales.

**Papel técnico:** centraliza idempotencia y outbox como garantías transversales del runtime HTTP.

| | |
|---|---|
| Clase | `RuntimeHardeningModule` |
| Archivos | 4 |
| Controllers | 0 |
| Rutas HTTP | 0 |
| Modelos usados | 2 |
| Esquemas de datos | [[platform_ops-schema\|platform_ops]] |

## Entradas

`VERIFICADO` — el módulo **no expone rutas HTTP**. Se invoca desde otros módulos o desde el trabajo de fondo.

## Salidas y efectos

Persiste en 2 tabla(s):

- [[idempotency_keys]] (`platform_ops`)
- [[outbox_events]] (`platform_ops`)

## Dependencias

**Depende de:** ningún otro módulo de negocio — es un módulo hoja.

**Del que dependen:** ningún módulo de negocio lo importa.

**Exporta:** `RuntimeHardeningService`, `IdempotencyInterceptor`, `ApiCommandOutboxInterceptor`

## Estructura interna

| Capa | Archivos |
|---|---|
| Controllers | — |
| Services | `runtime-hardening.service.ts` |
| Repositories | — |
| Esquemas Zod | — |
| Mappers | — |

## Autorización

Sin rutas HTTP: no aplica autorización de transporte.


## Pruebas

3 archivo(s) de test:

- `test/unit/runtime-hardening/idempotency.interceptor.spec.ts`
- `test/unit/runtime-hardening/outbox.interceptor.spec.ts`
- `test/unit/runtime-hardening/runtime-hardening.service.spec.ts`

## Referencias al código

- Módulo: [`src/modules/runtime-hardening/runtime-hardening.module.ts`](../../../../../src/modules/runtime-hardening/runtime-hardening.module.ts)


## Relaciones

- [[03-domains/index]] · [[02-architecture/dependency-map]] · [[13-change-impact/dependency-impact-map]]
