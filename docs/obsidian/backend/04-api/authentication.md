---
title: "API — autenticación"
type: "api"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - api
  - security
aliases: []
related: []
---
# API — autenticación

Cómo autenticarse contra la API. El detalle del mecanismo está en [[08-security/authentication]].

## Obtener un token

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "identifier": "<correo o teléfono>", "password": "<contraseña>" }
```

Los usuarios internos usan `POST /api/v1/internal/auth/login`.

## Usarlo

Dos formas, con **prioridad para la cookie**:

```http
Authorization: Bearer <access-token>
```

o la cookie de sesión que devuelve el login (requiere CORS con `credentials: true`, ya configurado).

> [!warning] Si envías ambas, gana la cookie
> Un `Bearer` correcto puede parecer ignorado si el navegador conserva una cookie de sesión antigua. Es la primera causa a descartar ante un 401 inesperado.

## Renovar

`POST /api/v1/auth/refresh` rota el access token usando el refresh token (vigencia `AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS`, 30 días).

## Cerrar sesión

`POST /api/v1/auth/logout` — revoca de verdad vía `TokenRevocationService`, no solo borra la cookie.

## Errores

| Código | Causa |
|---|---|
| `401` | Sin token; `Authorization` con formato distinto de `Bearer <token>`; token expirado, revocado o con rol desconocido |
| `403` | Autenticado pero sin permiso — ver [[04-api/authorization]] |
| `429` | Rate limit de los endpoints de auth |

## Desarrollo

`yarn dev:jwt --role=admin` emite un token local sin pasar por el login.

## Relaciones

- [[08-security/authentication]] · [[04-api/authorization]] · [[04-api/rest/auth]]
