---
title: "Versionado de la API"
type: "api"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - api
aliases: []
related: []
---
# Versionado de la API

## Estrategia

Versión en el **prefijo de ruta**: `API_PREFIX`, por defecto `api/v1`. No hay versionado por cabecera ni por negociación de contenido.

Hoy existe una sola versión. No hay `v2` ni rutas obsoletas.

## Qué NO va versionado

`/metrics` queda fuera del prefijo por convención de Prometheus. Su contrato es el formato de exposición de Prometheus, no el de la API.

## El modelo de lectura se versiona aparte

Las vistas de `read_api` llevan su versión en el nombre (`v_customer_overview_v1`), independiente de la versión de la API. Permite publicar `_v2` de una vista y migrar consumidores sin tocar el prefijo HTTP. Ver [[05-data/schemas]].

## Compatibilidad del contrato

`yarn check:openapi` compara el contrato generado con el versionado en `docs/endpoints/openapi.yaml`: un cambio de forma no declarado hace fallar el gate. Es lo que impide romper clientes sin enterarse.

Ver [[02-architecture/adr/0007-contrato-openapi-enriquecido|ADR-0007]] y [[11-quality/quality-gates]].

## Versión del artefacto

`buildInfo` (versión, commit, fecha de build) se expone en `GET /health`, lo que permite saber qué revisión atiende un request sin acceso al orquestador.

## Relaciones

- [[04-api/conventions]] · [[13-change-impact/compatibility-matrix]]
