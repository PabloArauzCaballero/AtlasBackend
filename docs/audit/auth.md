# Auditoría — Módulo `auth`

**Alcance revisado:**
- `src/modules/auth/auth.controller.ts`, `auth.service.ts`, `auth.repository.ts`, `auth.schemas.ts`, `auth.dtos.ts`, `auth.module.ts`
- `src/common/guards/jwt-auth.guard.ts`, `roles.guard.ts`
- `src/common/services/token-revocation.service.ts`, `src/common/auth/common-auth.module.ts`
- `src/common/utils/crypto/password.util.ts`, `refresh-token.util.ts`
- `src/database/models/auth-credentials.model.ts`, `auth-refresh-tokens.model.ts`
- `src/config/env.ts` (variables `JWT_*` / `AUTH_*`)
- Tests: `test/unit/auth/*.spec.ts`, `test/unit/common/guards/jwt-auth.guard.spec.ts`

**Resultado:** 4 hallazgos (1 crítico, 2 medios, 1 bajo), los 4 corregidos.
Suite de tests actualizada y verde (49/49). `tsc --noEmit` limpio.

---

## Hallazgo 1 — CRÍTICO: "cerrar sesión en todos los dispositivos" no revoca de inmediato si Redis está activo

**Dónde:** `AuthService.logout()` (antes de la corrección) llamaba a
`AuthRepository.bumpTokenVersion(credential)`.

**Qué pasaba:** existían **dos implementaciones independientes** de "incrementar
`tokenVersion`":
- `TokenRevocationService.bumpTokenVersion` (persiste en BD **y** actualiza la caché
  Redis vía write-through).
- `AuthRepository.bumpTokenVersion` (solo persistía en BD).

`JwtAuthGuard` resuelve la versión vigente de un token consultando **primero** la
caché Redis de `TokenRevocationService` (TTL 5 min) antes de ir a la base de datos.
`AuthService.logout` usaba la segunda implementación, que nunca toca esa caché. Es
decir: al cerrar sesión en todos los dispositivos, la base de datos quedaba correcta
de inmediato, pero cualquier access token ya emitido seguía siendo válido para
`JwtAuthGuard` hasta que la entrada de Redis expirara (hasta 5 minutos) — justo el
escenario de revocación inmediata esperado.

**Impacto:** en un incidente real (robo de sesión, empleado despedido, dispositivo
perdido) donde el usuario usa "cerrar sesión en todos los dispositivos" como
respuesta, el atacante/dispositivo comprometido conservaba acceso funcional durante
minutos adicionales si el despliegue usa Redis (`REDIS_URL` configurado, lo esperable
en producción). Sin Redis configurado el bug no se manifestaba (ambos caminos van
directo a BD), lo que probablemente explica que pasara desapercibido en desarrollo.

**Corrección aplicada:** `AuthService` ahora inyecta `TokenRevocationService` y
`logout()` llama a `tokenRevocationService.bumpTokenVersion(actorType, actorId)` en
vez de al método del repositorio. Se eliminó `AuthRepository.bumpTokenVersion` (quedaba
sin ningún otro caller — dejarlo vivo era una trampa para que el bug reapareciera si
alguien lo volvía a usar "por parecer más simple").

**Archivos:** `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.repository.ts`.
**Test de regresión:** `test/unit/auth/auth.service.spec.ts` → `AuthService.logout ›
revokes all refresh tokens AND bumps tokenVersion when allDevices=true` ahora
verifica explícitamente que se llama a `tokenRevocationService.bumpTokenVersion`, no
al repositorio.

---

## Hallazgo 2 — MEDIO: la rotación de refresh tokens nunca registraba `replacedByTokenId`

**Dónde:** `AuthService.refresh()` → `authRepository.revokeRefreshToken(stored,
'rotated')`.

**Qué pasaba:** el modelo `AuthRefreshTokenModel` y el método
`AuthRepository.revokeRefreshToken(token, reason, replacedByTokenId?)` soportan
registrar con qué token nuevo se reemplazó uno rotado — pensado para poder
reconstruir la cadena completa de rotación en una investigación de robo de refresh
token (si un token ya revocado se vuelve a presentar, se puede saber exactamente cuál
lo reemplazó y seguir la pista). En la práctica, el único call site real nunca pasaba
ese tercer argumento, así que la columna `replaced_by_token_id` quedaba siempre en
`null` para todo el histórico — la funcionalidad de trazabilidad existía en el
schema/repositorio pero estaba muerta en el único flujo que la ejercita.

**Corrección aplicada:** `issueRefreshToken` ahora devuelve `{ token, id }` (antes solo
el string) y `refresh()` pasa `newRefreshToken.id` como `replacedByTokenId` al revocar
el token anterior.

**Archivos:** `src/modules/auth/auth.service.ts`.
**Test de regresión:** `auth.service.spec.ts` → `AuthService.refresh › rotates the
refresh token...` verifica `revokeRefreshToken` llamado con el id del token nuevo.

---

## Hallazgo 3 — MEDIO: inconsistencia de `.trim()` entre provisión y verificación de contraseña

**Dónde:** `provisionCredentialsSchema.password` (`auth.schemas.ts`) usaba
`z.string().trim()...`; `loginSchema.password` no recorta espacios.

**Qué pasaba:** si un `admin`/`platform_admin` provisionaba una contraseña con un
espacio inicial o final (fácil al copiar/pegar desde un gestor de contraseñas o un
chat), el valor se recortaba antes de hashear. El usuario real, al loguearse
escribiendo exactamente esa contraseña (con el espacio, si de verdad la tenía), nunca
podría entrar porque `login` no recorta antes de verificar — el hash nunca
coincidiría. Es una fuente de bugs de soporte difíciles de diagnosticar ("mi
contraseña no funciona" sin causa aparente).

**Corrección aplicada:** se quitó `.trim()` de `provisionCredentialsSchema.password`
para que ambos lados traten el valor exactamente igual (ninguno recorta).

**Archivos:** `src/modules/auth/auth.schemas.ts`.

---

## Hallazgo 4 — BAJO: mensajes de error específicos en `JwtAuthGuard` eran código muerto

**Dónde:** `assertAuthenticatedUser()` (ahora `parseAuthenticatedUser()`) lanzaba
`UnauthorizedException('Payload JWT inválido.')` / `'Payload JWT incompleto.'`, pero
se invocaba **dentro** de un `try` cuyo `catch` reemplazaba cualquier excepción por el
mensaje genérico `'Token inválido o expirado.'`. Esos dos mensajes específicos nunca
llegaban al cliente — de hecho, el documento de contrato de API generado previamente
en esta conversación (`docs/endpoints/api-contract.md`) los describió como parte del
comportamiento real, lo cual era incorrecto.

**Impacto:** ninguno funcional (ocultar el detalle específico es, de hecho, la
práctica de seguridad correcta — no darle a un atacante pistas para distinguir "firma
inválida" de "payload incompleto"). El problema era de claridad: el código sugería un
comportamiento que no ocurría, y quien lo leyera (incluido yo mismo generando
documentación) podía documentar contrato incorrecto a partir de él.

**Corrección aplicada:** la función ahora se llama `parseAuthenticatedUser`, retorna
`null` en vez de lanzar, y `JwtAuthGuard.canActivate` lanza un único
`UnauthorizedException('Token inválido o expirado.')` explícito cuando el payload no
es válido — mismo comportamiento observable, código honesto sobre qué mensaje
realmente sale.

**Archivos:** `src/common/guards/jwt-auth.guard.ts`.
**Nota:** esto también significa que la sección de `docs/endpoints/api-contract.md`
y `docs/endpoints/openapi-systems-ops.yaml` que describía esos mensajes específicos
de `JwtAuthGuard` como parte del contrato de error de `401` debe leerse con esta
corrección en mente (el único mensaje real de `401` por payload inválido es
`"Token inválido o expirado."`).

---

## Observaciones registradas, sin corrección aplicada (no bloquean producción)

Estas quedan documentadas para decisión del equipo, no representan bugs de seguridad:

1. **`POST /auth/login` exige `x-tenant-id` incluso para `actorType: platform_user`**,
   pese a que `resolveActorForLogin` ignora el tenant para ese actor (los
   `platform_user` no están scoped a tenant). Un cliente que solo autentica
   `platform_admin`/`platform_user` debe enviar un header `x-tenant-id` "de mentira"
   solo para pasar la validación del controller. Es un wart de API, no un bug — no se
   cambió porque afecta el contrato público que el frontend ya integró.
2. **Refresh tokens expirados no se marcan como revocados de forma perezosa.**
   `AuthService.refresh()` rechaza un token expirado pero no lo revoca (
   `revokedAt` queda `null`) — no es explotable (la comprobación de `expiresAt` se
   repite en cada intento), pero ensucia la tabla `auth_refresh_tokens` con filas
   "activas" ya inútiles. Se podría cerrar marcando `revokedAt`/`revokedReason:
   'expired'` en el mismo branch que lanza el error. Bajo impacto, bajo esfuerzo —
   candidato a limpieza futura.

## Qué quedó verificado como correcto (sin cambios)

- Hashing de contraseñas: Argon2id con parámetros OWASP 2023 (`memoryCost=19456,
  timeCost=2, parallelism=1`), `verifyPassword` captura excepción de hash corrupto en
  vez de propagar 500.
- Refresh tokens: opacos (no JWT), 48 bytes de entropía (`randomBytes(48)`), solo se
  persiste el hash SHA-256 — el valor en claro no es reconstruible desde la base de
  datos.
- Mensajes de error de login deliberadamente genéricos e idénticos en los 3 casos de
  falla (actor inexistente, sin credenciales, contraseña incorrecta) — previene
  enumeración de cuentas.
- Bloqueo por intentos fallidos (`AUTH_MAX_FAILED_LOGIN_ATTEMPTS` /
  `AUTH_LOCKOUT_MINUTES`), verificado antes de comparar contraseña.
- `provisionCredentials` exige rol admin/platform_admin tanto en el decorador
  `@Roles` del controller como dentro del propio servicio (defensa en profundidad
  explícita), y rechaza reprovisionar credenciales ya existentes (`409 Conflict`).
- `env.ts` falla el arranque en `NODE_ENV=production` si `JWT_ACCESS_TOKEN_SECRET`
  quedó en su valor de desarrollo por defecto.
- Búsqueda de email de `internal_user`/`platform_user` case-insensitive
  (`LOWER(email) = LOWER(:input)`), robusta independiente de cómo se insertó el
  registro.
- Rotación de refresh tokens (revocar el usado + emitir uno nuevo) re-resuelve el rol
  vigente del actor **antes** de emitir el nuevo token, evitando dejar un refresh
  token huérfano si el actor fue desactivado entre medio.
