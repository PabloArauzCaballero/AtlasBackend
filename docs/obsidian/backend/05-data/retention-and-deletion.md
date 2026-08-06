---
title: "Retención y eliminación"
type: "data"
status: "verified"
owner: "unknown"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - data
  - privacy
aliases: []
related: []
---
# Retención y eliminación

## El borrado físico no es una opción

> [!warning] Ninguna FK borra en cascada
> `addForeignKeys` aplica `onDelete: allowNull ? 'SET NULL' : 'RESTRICT'` a las 244 FK. Un `DELETE FROM customers WHERE _id = …` **falla** si existe cualquier hijo obligatorio, y `customers` tiene 35 tablas apuntándole.
>
> Es deliberado: en un sistema auditado, perder evidencia por un borrado accidental es peor que acumular filas. La contrapartida es que **atender una supresión exige un procedimiento explícito**, no una sentencia.

## Los tres mecanismos

| Mecanismo | Qué hace | Dónde |
|---|---|---|
| **Borrado lógico** | `_deleted = true`; las lecturas lo excluyen | La mayoría de tablas |
| **Políticas de retención** | Purga o archiva según antigüedad y clasificación | `privacy.retention_policies` + job `apply_retention_policies` |
| **Solicitud del titular** | Expediente formal de acceso, rectificación o supresión | `privacy.data_subject_requests` |

## Índices únicos parciales

Donde hay borrado lógico, los índices únicos suelen llevar `WHERE _deleted = false`. Sin ese filtro, una fila borrada seguiría bloqueando su código o identificador para siempre y el "borrado" impediría dar de alta un reemplazo.

## Endurecimiento de `_deleted`

La migración `20260721120000-harden-deleted-flag-not-null` convirtió `_deleted` en `NOT NULL`.

> [!info] Por qué importaba
> Con `_deleted` nullable, `WHERE _deleted = false` **no devuelve** las filas con `NULL` (en SQL, `NULL = false` es `NULL`, no `true`). Filas nunca marcadas quedaban invisibles para consultas escritas de la forma natural. Forzar `NOT NULL` elimina la clase entera de error.

## Retención por tipo de dato

`INFERIDO` — el detalle vive en datos (`retention_policies`), no en código, así que depende del entorno:

| Dato | Política |
|---|---|
| Claves de idempotencia | `RUNTIME_JOBS_IDEMPOTENCY_RETENTION_DAYS`, job dedicado, lotes de 1 000 |
| Sesiones inactivas | Expiran tras `RUNTIME_JOBS_SESSION_MAX_IDLE_MINUTES` |
| Eventos del outbox | `NO_CONFIRMADO` — no se detectó purga específica |
| Logs de aplicación | Sincronizados a MongoDB; retención según ese almacén |
| Evidencia documental | `data_providers.default_retention_policy_id`, `data_provider_responses.retention_policy_id` |

> [!question] Pendiente
> **El crecimiento de `outbox_events` no tiene purga visible.** Los eventos en `processed` se acumulan salvo que una política de retención los cubra por configuración. Conviene confirmarlo contra un entorno real: es la tabla con mayor tasa de inserción del sistema.

## Trazabilidad del borrado

`audit.data_change_logs` registra los cambios de datos, incluidos los borrados lógicos. Eliminar sin dejar rastro del acto de eliminar sería incompatible con la auditoría.

## Relaciones

- [[05-data/sensitive-data]] · [[07-async-processing/schedulers]] · [[14-audits/risks-register]]
