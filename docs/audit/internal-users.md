# Auditoría — Módulo `internal-users`

**Alcance revisado:**
- `internal-auth.controller.ts` / `.service.ts` (login/refresh/logout/me/signup internos)
- `internal-users.controller.ts` / `.service.ts` (listar/consultar/editar usuarios, reemplazar roles)
- `internal-access-catalog.controller.ts` / `.service.ts` / `.repository.ts` (catálogo de roles/permisos, solo lectura)
- `internal-rbac.repository.ts`, `internal-rbac.roles.ts`, `internal-rbac.permissions.ts`, `internal-rbac.seed-data.ts`
- `guards/internal-permissions.guard.ts`, `internal-permissions.decorator.ts`
- `internal-users.schemas.ts`, `internal-users.types.ts`, `internal-access-catalog.schemas.ts/types.ts`
- Tests: `test/unit/internal-users/*.spec.ts`

**Resultado:** 3 hallazgos (1 alto, 2 medios), los 3 corregidos. Se agregaron 2 tests de
regresión nuevos (antes no existía cobertura para ninguno de los dos escenarios). Suite
verde (10/10 en el módulo, 63/63 incluyendo `auth`/`common`). `tsc --noEmit` limpio.

---

## Hallazgo 1 — ALTO: se puede despojar el rol `SUPER_ADMIN` de otro usuario sin ser `SUPER_ADMIN`

**Dónde:** `InternalUsersService.replaceRoles()` → `assertCanAssignRequestedRoles()`.

**Qué pasaba:** `PATCH /internal/users/:id/roles` reemplaza **todo** el conjunto de roles
de un usuario interno. El guard de negocio (`assertCanAssignRequestedRoles`) solo exigía
`SUPER_ADMIN` al actor cuando la lista de roles **nueva** incluía un rol privilegiado
(`SUPER_ADMIN`, `SYSTEMS_ADMIN`, `INTERNAL_IDENTITY_ADMIN`). Nunca miraba los roles que el
usuario objetivo **ya tenía** y que la operación iba a **quitar**.

El endpoint solo exige los permisos `internal.users.manage` + `internal.roles.manage`
(`InternalPermissions` en el controller). Revisando `internal-rbac.permissions.ts`, el rol
`INTERNAL_IDENTITY_ADMIN` tiene ambos permisos **sin** ser `SUPER_ADMIN`. Es decir: un
usuario con rol `INTERNAL_IDENTITY_ADMIN` podía llamar a este endpoint sobre un
`SUPER_ADMIN` real, enviar `{ roles: ['SUPPORT_AGENT'] }`, y el chequeo se saltaba por
completo (la lista nueva no "asigna" ningún rol crítico) — despojando en silencio el
`SUPER_ADMIN` del objetivo.

**Impacto:** un rol pensado para "gestión de identidades" (no necesariamente el más alto
privilegio del sistema) podía neutralizar a todos los `SUPER_ADMIN`/`SYSTEMS_ADMIN` de un
tenant sin nunca haber probado tener ese nivel de privilegio — un vector de sabotaje
interno (bloqueo administrativo total) o de encubrimiento (demover al admin que podría
estar auditando las propias acciones del atacante).

**Corrección aplicada:** `assertCanAssignRequestedRoles` ahora recibe también los roles
**actuales** del usuario objetivo (`currentRoleCodes`) y exige `SUPER_ADMIN` si un rol
privilegiado aparece en la lista nueva **o** en la actual (es decir, tanto para asignar
como para quitar un rol crítico). `replaceRoles()` construye el perfil actual del objetivo
(`buildAccessProfile(user)`) antes de aplicar el reemplazo y se lo pasa al chequeo.

**Archivos:** `src/modules/internal-users/internal-users.service.ts`.
**Test de regresión (nuevo):** `internal-users.service.spec.ts` → `rejects stripping a
privileged role from the target when the actor is not SUPER_ADMIN (regression)`.

---

## Hallazgo 2 — MEDIO: suspender/bloquear/deshabilitar un usuario interno no invalida su access token vigente

**Dónde:** `InternalUsersService.updateUser()`.

**Qué pasaba:** al cambiar el `status` de un usuario interno a `suspended`/`locked`/
`disabled`, el servicio persistía el cambio en la base de datos pero nunca incrementaba
`tokenVersion`. `JwtAuthGuard` no vuelve a consultar el estado del usuario en cada
request — solo valida firma/expiración del JWT y compara `tokenVersion` contra la versión
vigente (exactamente el mecanismo que el propio módulo `auth` usa para "logout en todos
los dispositivos", ver `docs/audit/auth.md` hallazgo 1). Como aquí nunca se llamaba, un
usuario recién suspendido conservaba acceso funcional completo con su access token ya
emitido hasta su expiración natural (`JWT_ACCESS_TOKEN_EXPIRES_IN`, por defecto 1h).

**Impacto:** el caso de uso típico de "suspender/bloquear" (empleado despedido, cuenta
comprometida, incidente de seguridad) es precisamente el que necesita efecto inmediato.
Sin este fix, el usuario deshabilitado podía seguir operando el panel interno durante
hasta una hora después de que un admin creyera haberlo bloqueado.

**Corrección aplicada:** `InternalUsersService` ahora inyecta `TokenRevocationService`
(módulo `@Global()`, ya disponible en todo el proyecto — no requirió cambios en
`internal-users.module.ts`) y, tras persistir un cambio a un estado deshabilitado,
llama a `tokenRevocationService.bumpTokenVersion('internal_user', targetUserId)`.

**Archivos:** `src/modules/internal-users/internal-users.service.ts`.
**Test de regresión (nuevo):** `internal-users.service.spec.ts` → `invalidates the
currently active access token when an internal user is disabled (regression)`.
**Nota de diseño:** `bumpTokenVersion` asume que existen credenciales para el actor (lanza
si no) — invariante válida aquí porque `createUserWithCredentials` siempre crea la fila de
credenciales en la misma transacción que crea el usuario interno (no existe un flujo de
"usuario interno sin credenciales" en este módulo).

---

## Hallazgo 3 — MEDIO: inconsistencia de `.trim()` en la contraseña de alta de usuario interno

**Dónde:** `createInternalUserSchema.password` (`internal-users.schemas.ts`).

**Qué pasaba:** mismo patrón que el hallazgo 3 de `auth` (ver `docs/audit/auth.md`):
`createInternalUserSchema.password` recortaba espacios con `.trim()` antes de hashear,
pero `internalLoginSchema.password` no. Una contraseña con espacio inicial/final asignada
al crear el usuario quedaría hasheada sin él; el usuario real, escribiéndola tal cual al
loguearse, nunca coincidiría.

**Corrección aplicada:** se quitó `.trim()` de `createInternalUserSchema.password`.

**Archivos:** `src/modules/internal-users/internal-users.schemas.ts`.

---

## Qué quedó verificado como correcto (sin cambios)

- `InternalPermissionsGuard` exige sesión interna real (`tenantId` + `internalUserId` en el
  JWT) antes de siquiera consultar permisos — no hay forma de que un `customer`/
  `platform_user` pase este guard.
- `assertInternalActor` valida que `tenantId`/`internalUserId` sean enteros positivos
  representados como texto antes de usarlos en cualquier query (defensa contra
  inyección/valores inesperados en el payload del JWT).
- `createUser`/`updateUser`/`replaceRoles` registran auditoría (`createAudit`) de cada
  cambio con actor, motivo (`reason`, obligatorio y con longitud mínima en el schema) e
  IP/user-agent — trazabilidad completa de acciones administrativas sensibles.
- `createUser` rechaza crear un usuario fuera del tenant del actor
  (`tenantId !== actor.tenantId → ForbiddenException`) incluso si el body intenta
  especificar un `tenantId` distinto.
- `updateUser` impide que un actor se auto-suspenda/bloquee/deshabilite
  (`targetUserId === actor.internalUserId` con status deshabilitado → Forbidden),
  evitando un bloqueo accidental sin salida.
- `replaceRoles` impide reemplazar los propios roles desde este endpoint (mismo tipo de
  protección contra auto-bloqueo).
- Búsqueda de usuario por email case-insensitive y con `deleted: false` explícito en
  todas las consultas — no hay forma de "resucitar" acceso a través de un registro
  lógicamente borrado.
- `internal.users.manage`/`internal.roles.manage` tienen alias de compatibilidad
  (`permissionAliases`) hacia nombres de permisos legados (`rbac.internal_users.*`) —
  mecanismo explícito y centralizado, no duplicado por todo el código.
