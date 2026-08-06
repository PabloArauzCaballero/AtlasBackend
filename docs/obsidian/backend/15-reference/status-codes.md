---
title: "Códigos de estado"
type: "reference"
status: "verified"
owner: "unknown"
criticality: "low"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - reference
aliases: []
related: []
---
# Códigos de estado

Extraídos de los decoradores `@ApiResponse` de los 48 controllers.

| Código | Uso en Atlas |
|---|---|
| 200 | Éxito |
| 201 | Creación — `@HttpCode(HttpStatus.CREATED)` |
| 400 | Validación Zod; cabecera obligatoria ausente |
| 401 | Autenticación fallida |
| 403 | Autorización fallida: rol, tenant o pertenencia |
| 404 | No existe o no es visible para el actor |
| 409 | Conflicto |
| 422 | Regla de negocio incumplida |
| 429 | Rate limit |
| 500 | Error no controlado |
| 503 | No listo, o timeout de request |

El desglose por endpoint está en [[15-reference/endpoint-catalog]] y en las notas de `04-api/rest/`.

## Relaciones

- [[04-api/error-model]] · [[15-reference/error-catalog]]
