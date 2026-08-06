---
title: "Convenciones de código"
type: "reference"
status: "verified"
owner: "unknown"
criticality: "high"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - development
aliases: []
related: []
---
# Convenciones de código

Derivadas del código real y de `.claude/rules/`.

## Cabecera de archivo

Todo archivo abre con:

```ts
/**
 * @file  <qué es este artefacto>
 * @business <qué capacidad de negocio sostiene>
 * @system <qué papel técnico cumple>
 */
```

Se cumple en los 686 archivos de `src/`, y es la fuente de buena parte de esta bóveda.

## Capas

```
controller  →  valida (ZodValidationPipe), autoriza, delega. Sin lógica de negocio.
service     →  reglas de negocio, transacciones, orquestación.
repository  →  solo persistencia.
mapper      →  modelo Sequelize → DTO.
schemas.ts  →  Zod; también genera el contrato OpenAPI.
```

**Nunca** devolver un modelo Sequelize al transporte HTTP.

## Tipado

- Preferir `unknown` + validación antes que `any`. El repositorio tiene ~0 `any` en runtime.
- Identificadores `BIGINT` como `string`, no `number`.
- `declare` en las propiedades de modelo (requisito de `sequelize-typescript` con ESM).

## Módulos

- Sin dependencias circulares. `forwardRef` **prohibido** salvo justificación explícita — hoy hay cero.
- No exportar repositories salvo necesidad transaccional real y documentada.
- `common/` no importa de `modules/`.

## Errores

- Nada de `catch {}` que trague.
- Un `catch` deliberado traduce a excepción tipada o degrada **con comentario que explique por qué**.
- Fire-and-forget: `void x().catch(log)`, nunca una promesa suelta.

## Imports ESM

Los imports internos llevan extensión `.js` aunque el archivo sea `.ts`:

```ts
import { AppModule } from './app.module.js';
```

## Comentarios

La convención más distintiva del proyecto: **los comentarios explican el porqué y las alternativas descartadas**, no lo que ya dice el código.

```ts
// El techo NO es opcional aquí: este es el único chequeo que decide el readiness,
// así que es el que el orquestador espera.
```

Un comentario que reformula la línea siguiente sobra; uno que explica por qué **no** se hizo lo obvio, no.

## Idioma

Comentarios, mensajes de error y documentación en **español**. Identificadores en inglés.

## Tamaño

`yarn check:file-size` es un trinquete: no crecer archivos ya grandes, no introducir archivos nuevos por encima del límite.

## Relaciones

- [[12-development/local-setup]] · [[11-quality/quality-gates]] · [[02-architecture/architectural-style]]
