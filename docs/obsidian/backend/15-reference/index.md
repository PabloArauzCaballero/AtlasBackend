---
title: "Referencia — índice"
type: "reference"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "medium"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - reference
aliases: []
related: []
---

# Referencia — índice

Catálogos y tablas de consulta. Todo lo de aquí se extrae del código: si el código cambia, hay que regenerarlo.

## Catálogos

| Nota | Contenido | Elementos |
|---|---|---:|
| [[15-reference/endpoint-catalog]] | Todas las rutas con método, auth, roles y controller | 266 |
| [[15-reference/entity-catalog]] | Todas las tablas con esquema, modelo y atributos | 130 |
| [[15-reference/events-catalog]] | Tipos de evento por familia | 92 |
| [[15-reference/permissions-matrix]] | Qué rol alcanza qué | 13 + 20 roles |
| [[15-reference/environment-variables]] | Variables validadas con Zod | 159 |
| [[15-reference/error-catalog]] | Errores y su traducción a HTTP | — |
| [[15-reference/status-codes]] | Códigos de estado en uso | 11 |
| [[15-reference/commands]] | Comandos de `package.json` verificados | — |
| [[15-reference/ports]] | Puertos y su exposición | 5 |
| [[15-reference/source-index]] | Dónde vive cada cosa en el código | — |

## Catálogos que viven en otras secciones

| Nota | Por qué está allí |
|---|---|
| [[05-data/relationship-catalog]] | Las 244 FK, junto al resto del modelo de datos |
| [[05-data/data-dictionary]] | Convenciones de campo transversales |
| [[05-data/migrations]] | Las 61 migraciones |
| [[02-architecture/components]] | Catálogo de componentes arquitectónicos |
| [[02-architecture/communication-matrix]] | Quién habla con quién |

## Cómo se regeneran

Los catálogos se producen por análisis estático del árbol de fuentes: decoradores de controller, decoradores de modelo, especificaciones de las migraciones y esquemas Zod. El método y sus límites están en [[01-overview/assumptions-and-gaps]].

## Relaciones

- [[00-home/navigation-map]] · [[_meta/source-inventory]]
