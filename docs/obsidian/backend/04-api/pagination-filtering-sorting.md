---
title: "Paginación, filtrado y orden"
type: "api"
status: "verified"
owner: "unknown"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - api
aliases: []
related: []
---
# Paginación, filtrado y orden

## Cursor por defecto, `OFFSET` como excepción acotada

El cursor (*keyset*) es el camino **por defecto para listados de alto volumen** — ya aplicado en `audit`, `events`, `operations` y `data-quality`.

`OFFSET` se conserva **solo** para pantallas administrativas pequeñas y acotadas, donde la profundidad es baja y un total exacto aporta más de lo que cuesta. Ver [[02-architecture/adr/0005-paginacion-por-cursor|ADR-0005]].

> [!info] Por qué no offset
> `OFFSET n` obliga a PostgreSQL a leer y descartar `n` filas: el coste crece con la profundidad de la página. Y en un listado que recibe escrituras concurrentes, insertar una fila desplaza el resto y hace que un elemento aparezca dos veces o se salte entre páginas.
>
> El cursor ancla la posición a un valor real de la fila, así que ni el coste crece ni el desplazamiento afecta. A cambio, puede devolver resultados **sin total exacto**: contar sobre tablas de eventos o auditoría es caro, y ese es justo el caso donde el cursor gana.

## Forma habitual

| Parámetro | Uso |
|---|---|
| `limit` | Tamaño de página; **máximo 100** |
| `cursor` | Posición devuelta por la página anterior |

Los listados ordenan por una clave estable —típicamente `(_created_at DESC, _id DESC)`— para que el cursor sea determinista incluso con marcas de tiempo repetidas.

Ejemplo real de índice que lo sostiene: `idx_customer_status_events_tenant_happened ON customer_status_events (_tenant_id, happened_at DESC, _id DESC)`.

## Compresión

`compression()` comprime por encima de 1 KB: un listado con `limit=100` viaja comprimido si el cliente envía `Accept-Encoding`.

## Gate de sobrelectura

`yarn check:overfetching` vigila que las consultas no seleccionen columnas que no se usan — relevante cuando hay columnas `BLOB` de PII que no deben viajar sin motivo.

## Relaciones

- [[04-api/conventions]] · [[05-data/data-architecture]]
