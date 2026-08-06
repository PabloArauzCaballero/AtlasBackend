---
title: "Autenticación"
type: "security"
status: "verified"
owner: "@PabloArauzCaballero"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - security
  - authentication
source_files:
  - "src/common/guards/jwt-auth.guard.ts"
  - "src/common/utils/auth/jwt-claims.util.ts"
  - "src/common/utils/http/auth-cookies.util.ts"
  - "src/modules/auth/auth.controller.ts"
aliases: []
related: []
---

# Autenticación

## Mecanismo

JWT firmado con **HS256**, algoritmo fijado tanto al firmar como al verificar (impide el ataque de sustitución de algoritmo), con `issuer` y `audience` acotados.

| Elemento | Variable | Default |
|---|---|---|
| Secreto | `JWT_ACCESS_TOKEN_SECRET` | valor de desarrollo — bloqueado en producción por Zod |
| Vigencia del access token | `JWT_ACCESS_TOKEN_EXPIRES_IN` | `1h` |
| Emisor | `JWT_ISSUER` | `atlas-backend` |
| Audiencia | `JWT_AUDIENCE` | `atlas-api` |
| Vigencia del refresh token | `AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS` | `30` |

> [!info] Por qué `issuer` y `audience`
> El comentario del código remite al hallazgo A-08 de la auditoría interna: acotan **para qué** vale un token. Sin ellos, un token emitido por otro sistema con el mismo secreto sería aceptado.

## Dos transportes, con prioridad

`extractAccessToken()` busca en este orden:

1. **Cookie de sesión** (`ACCESS_TOKEN_COOKIE`)
2. **Cabecera** `Authorization: Bearer <token>`

Sin ninguna de las dos → `401 "Sesión requerida"`.

> [!warning] Un `Authorization` mal formado falla de inmediato
> Si la cabecera existe pero no es exactamente `Bearer <token>`, se lanza `401 "Formato de Authorization inválido"` — **no** se ignora para caer al siguiente método. Un cliente que envíe una cabecera rota no obtiene un fallback silencioso.
>
> Nota operativa: como la cookie tiene prioridad, un cliente que envíe **ambas** usará la cookie. Al depurar un 401 con un `Bearer` que parece correcto, comprobar primero si hay una cookie de sesión antigua en el navegador.

## Validación del payload

`parseAuthenticatedUser()` rechaza el token (→ `null` → 401) si:

- el payload es una cadena en vez de un objeto;
- `sub` no es `string`;
- `role` no es `string`;
- **`role` no pertenece a `ATLAS_USER_ROLES`**.

El resto de claims (`tenantId`, `customerId`, `internalUserId`, `platformUserId`, `tokenVersion`) se copian solo si tienen el tipo esperado; si no, quedan `undefined` en vez de propagar un valor de tipo inesperado.

## Revocación

`TokenRevocationService` comprueba el token contra el estado de revocación usando `tokenVersion` y el actor. Permite invalidar sesiones sin esperar a que expire el token — necesario para cerrar sesión de verdad, bloquear una cuenta o reaccionar a un incidente.

La regla del proyecto añade: *"en producción, rechazar tokens sin `tokenVersion`/actor"*.

## Endpoints públicos de autenticación

| Endpoint | Propósito |
|---|---|
| `POST /auth/login` | Login de cliente |
| `POST /auth/login/pin` | Verificación de PIN (`AUTH_LOGIN_PIN_ENABLED`) |
| `POST /auth/password-reset/request` | Solicitar restablecimiento |
| `POST /auth/password-reset/confirm` | Confirmar restablecimiento |
| `POST /auth/refresh` | Rotar el access token |
| `POST /auth/logout` | Cerrar sesión |

Más `POST /internal/auth/login` y afines para usuarios internos. Todos llevan `@Throttle` estricto: son la superficie de fuerza bruta.

## Protecciones contra abuso de credenciales

| Control | Variable |
|---|---|
| Máximo de intentos fallidos | `AUTH_MAX_FAILED_LOGIN_ATTEMPTS` (5) |
| Bloqueo tras superarlos | `AUTH_LOCKOUT_MINUTES` (15) |
| Vigencia del código de un solo uso | `AUTH_ONE_TIME_CODE_TTL_MINUTES` (10) |
| Intentos por código | `AUTH_ONE_TIME_CODE_MAX_ATTEMPTS` (5) |
| Hash de contraseña | `argon2` |
| Rate limiting | `@Throttle` estricto + almacén Redis compartido |

Los intentos quedan registrados en `telemetry.auth_events`, y los códigos en `iam.auth_one_time_codes`.

## Cookies

| Variable | Efecto |
|---|---|
| `AUTH_COOKIE_SAMESITE` | `lax` (default), `strict` o `none` |
| `AUTH_COOKIE_SECURE` | Default: `true` en producción |
| `AUTH_COOKIE_DOMAIN` | Ámbito de la cookie |

> [!info] Una validación cruzada que evita un login roto
> `env.ts:33-38` **falla al arrancar** si `AUTH_COOKIE_SAMESITE=none` sin `AUTH_COOKIE_SECURE=true`. Los navegadores descartan esa combinación en silencio: la sesión simplemente no se establecería y el síntoma sería "el login no funciona" sin ningún error en el servidor. Se prefiere no arrancar.

## MFA

`POST /auth/mfa` (autenticado) y `customer_mfa` en `auth_credentials`, añadido por la migración `20260717000000`. El PIN de super admin solo se exige bajo la condición documentada en `AUTH_LOGIN_PIN_ENABLED`.

## Relaciones

- [[08-security/authorization]] · [[04-api/authentication]] · [[02-architecture/critical-sequences]] · [[03-domains/auth/index]]
