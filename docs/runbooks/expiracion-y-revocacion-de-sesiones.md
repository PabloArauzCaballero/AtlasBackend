# Runbook: expiración y revocación de sesiones

Cómo cortar el acceso de un actor (cliente o usuario interno) de forma inmediata o
programada. Relacionado: [`auth.service.ts`](../../src/modules/auth/auth.service.ts),
[`auth.repository.ts`](../../src/modules/auth/auth.repository.ts),
[`auth.controller.ts`](../../src/modules/auth/auth.controller.ts).

## Modelo de sesión (contexto)

- **Access token (JWT):** de vida corta (`JWT_ACCESS_TOKEN_EXPIRES_IN`, por defecto
  `1h`). Lleva un claim `tokenVersion`.
- **Refresh token:** opaco, **hasheado** en base (`tokenHash`), con `revokedAt` /
  `revokedReason`. Vida `AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS` (por defecto 30 días). Se
  **rota** en cada refresh.
- **`tokenVersion`:** contador por credencial. Al **incrementarlo**, todos los access
  tokens emitidos con la versión anterior dejan de ser válidos aunque aún no hayan
  expirado — es la palanca de **revocación inmediata**.
- **Lockout por fuerza bruta:** tras `AUTH_MAX_FAILED_LOGIN_ATTEMPTS` (5) intentos
  fallidos, la credencial queda bloqueada `AUTH_LOCKOUT_MINUTES` (15) minutos
  (`lockedUntil`).

## Escenario 1 — Revocar TODAS las sesiones de un actor (ya)

Úsalo si sospechas robo de credenciales de ese actor.

1. **Incrementar `tokenVersion`** de la credencial → invalida sus access tokens
   vigentes de inmediato. (Endpoint de revocación del actor; ver `auth.controller.ts`,
   "invalida los access tokens vigentes (tokenVersion)").
2. **Revocar sus refresh tokens** (`logout` con `allDevices: true`, o marcar
   `revokedAt` en la tabla de refresh tokens del actor).
3. Verificar: un intento de refresh con un token viejo debe fallar; un access token
   viejo debe recibir `401`.

## Escenario 2 — Cerrar una sola sesión/dispositivo

1. `logout` con el `refreshToken` de esa sesión (sin `allDevices`) → marca ese refresh
   token como `revokedAt`.
2. El access token de esa sesión expira solo dentro de su ventana corta (≤ 1h); si se
   requiere corte inmediato del access token, usar el Escenario 1 (tokenVersion).

## Escenario 3 — Revocación masiva (rotación de `JWT_ACCESS_TOKEN_SECRET`)

Para invalidar **todos** los access tokens de **toda** la flota a la vez, rotar el
secreto de firma según [rotacion-de-claves.md, sección C](rotacion-de-claves.md).
Los clientes activos recibirán `401` y refrescarán automáticamente.

## Escenario 4 — Desbloquear un actor bloqueado por lockout

Un lockout legítimo se auto-libera al pasar `lockedUntil`. Para desbloquear antes
(p. ej. soporte a un usuario tras verificar identidad):

1. Verificar identidad por un canal fuera de banda.
2. Limpiar `lockedUntil` y el contador de intentos fallidos de la credencial.
3. Recomendar reset de contraseña si el bloqueo lo causó un tercero.

## Verificación

- [ ] Refresh con token revocado → error.
- [ ] Access token pre-revocación → `401` (si se usó tokenVersion o rotación de secreto).
- [ ] El actor legítimo puede volver a iniciar sesión y obtener un par de tokens nuevo.
