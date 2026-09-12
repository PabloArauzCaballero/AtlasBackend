---
title: "Matriz de compatibilidad"
type: "reference"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - change-impact
aliases: []
related: []
---
# Matriz de compatibilidad

## Versiones del entorno

| Componente | Requisito | Origen |
|---|---|---|
| Node.js | ≥ 22 | `engines`, `.nvmrc`, imagen base |
| PostgreSQL | `INFERIDO` — usa `JSONB`, `GIN`, índices parciales, `INET` | Migraciones |
| Redis | `NO_CONFIRMADO` — no se declara versión mínima | `ioredis` |
| MongoDB | `NO_CONFIRMADO` | Driver `mongodb` |

## Compatibilidad durante el despliegue

| Fase | Esquema | Código | Debe funcionar |
|---|---|---|---|
| Antes | viejo | viejo | ✅ |
| Tras `migrate` | **nuevo** | viejo | ⚠️ **la ventana crítica** |
| Durante el *rollout* | nuevo | mixto | ⚠️ |
| Después | nuevo | nuevo | ✅ |

Regla: **toda migración debe ser compatible hacia atrás con el código en curso**.

| Cambio | ¿Seguro en un paso? |
|---|---|
| Añadir columna nullable | ✅ |
| Añadir columna `NOT NULL` con default | ⚠️ bloqueo según volumen |
| Añadir columna `NOT NULL` sin default | ❌ rompe inserciones del código viejo |
| Renombrar columna | ❌ dos fases |
| Eliminar columna | ❌ desplegar primero el código que deja de usarla |
| Añadir índice | ✅ (`CONCURRENTLY` si el volumen lo pide) |
| Añadir FK | ⚠️ valida las filas existentes |
| Añadir CHECK | ⚠️ ídem |

## Contrato de API

Versión única `v1`. `yarn check:openapi` detecta cambios de forma no declarados.

| Cambio | Compatible |
|---|---|
| Añadir campo opcional a la respuesta | ✅ |
| Añadir parámetro opcional | ✅ |
| Añadir campo obligatorio a la petición | ❌ |
| Quitar o renombrar campo de la respuesta | ❌ |
| Endurecer una validación | ❌ |
| Cambiar un código de estado | ❌ |

## Modelo de lectura

Las vistas llevan versión en el nombre (`_v1`): publicar `_v2` y migrar consumidores es el camino no disruptivo.

## Relaciones

- [[10-operations/deployment]] · [[04-api/versioning]] · [[05-data/migrations]]
