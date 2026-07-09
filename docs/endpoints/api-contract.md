# Contrato HTTP completo — Atlas Backend (para frontend)

> Generado a partir de la lectura directa de controladores, DTOs, schemas Zod, mappers y servicios reales del backend (no a mano). Prefijo global de todas las rutas: `/api/v1`.

Este documento describe, endpoint por endpoint: método + ruta, autenticación/roles requeridos, headers, path/query params, forma exacta del request body (con constraints) y forma exacta de la response (siguiendo el mapper/servicio real), además de las excepciones conocidas que puede lanzar cada uno.

## Índice de módulos

1. [Auth e Internal Users](#modulo-01) — login, refresh, logout, gestión de usuarios internos, roles y permisos
2. [Customers / Onboarding / Privacy / Telemetry](#modulo-02) — alta de clientes, verificación de contacto, privacidad, telemetría de dispositivo
3. [Consents / Sessions / Risk / External Data](#modulo-03) — consentimientos, sesiones, scoring de riesgo, proveedores externos (SEGIP, Infocenter, QR, banca, telco, redes sociales, KYC)
4. [Operations / Data Quality / Audit / Catalog Management](#modulo-04) — cola de trabajo interna, casos de fraude/revisión manual, calidad de datos, auditoría, catálogos y política de riesgo
5. [Systems Ops](#modulo-05) — catálogo técnico de endpoints/tools/entidades de datos, action log, review queue, pruebas de stress y smoke interno
6. [Schema Management / Internal Portal / Notifications / Events / Health / Runtime Jobs](#modulo-06)

## Convenciones

- Todas las rutas mostradas ya incluyen el prefijo `/api/v1`.
- `Auth` indica el guard/rol real leído del controlador (no asumido): `@Public()`, `JwtAuthGuard`, `@Roles(...)`, permisos internos, etc.
- Cuando un endpoint pagina, se documenta el shape real (`items`/`meta` en la mayoría; algunos módulos usan `items`/`total` o array plano — se marca explícitamente cuando difiere).
- Los hallazgos marcados como **Nota** señalan comportamientos reales del código que pueden sorprender al frontend (campos que siempre vienen `null`, validaciones ausentes, paginación en memoria, etc.).

---

<a id="modulo-01"></a>

# Contrato HTTP: Auth e Internal Users

Prefijo global de todas las rutas: `/api/v1` (`env.API_PREFIX`, default `api/v1`, configurable por variable de entorno).

Notas transversales:
- **Guard global de throttling:** `ThrottlerGuard` aplica a nivel de app (`APP_GUARD` en `app.module.ts`) a todas las rutas, además de lo indicado por endpoint.
- **`JwtAuthGuard`**: valida `Authorization: Bearer <token>` (HS256, secreto `JWT_ACCESS_TOKEN_SECRET`). Si el handler/clase tiene `@Public()`, se omite la validación. Si el payload trae `tokenVersion`, se compara contra la versión vigente en `auth_credentials`/tabla equivalente vía `TokenRevocationService`; si no coincide (contraseña rotada o logout "todos los dispositivos"), devuelve `401 Token revocado. Inicia sesión nuevamente.`. Sin header `Authorization` → `401 Token Bearer requerido.`. Formato inválido (`scheme !== 'Bearer'`) → `401 Formato de Authorization inválido. Use: Bearer <token>.`. Token inválido/expirado/payload incompleto → `401 Token inválido o expirado.` / `401 Payload JWT incompleto.`.
- **`RolesGuard`** (solo se usa en `AuthController`): si el handler tiene `@Roles(...)`, exige que `user.role` esté en esa lista; si no, `403 El usuario autenticado no tiene permiso para esta operación.`. Sin `@Roles`, deja pasar.
- **`InternalPermissionsGuard`** (usado en los 3 controladores de `internal-users`): si el handler tiene `@InternalPermissions(...)`, exige sesión interna (`user.tenantId` y `user.internalUserId` presentes; si no, `403 Esta operación requiere una sesión interna.`) y que el usuario tenga **todos** los permisos listados (lógica AND vía `Array.every`) según el RBAC dinámico (`internal_rbac.repository.ts`); si falta alguno, `403 El usuario interno no tiene los permisos requeridos para esta operación.`.
- Los DTOs de body se validan con `ZodValidationPipe` — un error de validación produce `400 Bad Request` con el detalle de Zod formateado por el pipe.
- Los IDs de path/tenant vienen como string numérico positivo (`/^[1-9][0-9]*$/`); si no cumplen el patrón, `parsePositiveId` lanza `400 BadRequestException` (`"{campo} debe ser un entero positivo representado como texto."`).

---

## Módulo: AuthController (`src/modules/auth/auth.controller.ts`)

Prefijo del controlador: `auth` → rutas bajo `/api/v1/auth/...`.
Guards de clase: `@UseGuards(JwtAuthGuard, RolesGuard)`.

### POST /api/v1/auth/login

**Propósito:** Autenticar a un `customer`, `internal_user` o `platform_user` y emitir un par access+refresh token.
**Auth:** `@Public()` — no requiere token. `RolesGuard` no aplica (sin `@Roles`).
**Headers:** `x-tenant-id` (obligatorio, string numérico positivo — se parsea con `parsePositiveId`; si falta o es inválido → `400`).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| (ninguno) | — | — |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| (ninguno) | — | — | — | — |

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| actorType | enum | Sí | `customer` \| `internal_user` \| `platform_user` | Tipo de actor a autenticar |
| identifier | string | Sí | trim, min 3, max 180 | Teléfono/email (customer) o email corporativo (internal_user/platform_user) |
| password | string | Sí | min 1, max 128 | Contraseña en texto plano |

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| accessToken | string | JWT firmado HS256, expira en `JWT_ACCESS_TOKEN_EXPIRES_IN` |
| refreshToken | string | Token opaco aleatorio, se persiste hasheado |
| tokenType | `'Bearer'` | Constante |
| expiresIn | string | Duración configurada del access token (p. ej. `"1h"`) |

**Errores**
- Actor inexistente, sin credenciales o password incorrecto → `401 Credenciales inválidas.` (mensaje genérico deliberado, no distingue casos)
- Cuenta bloqueada por intentos fallidos (`lockedUntil` futuro) → `401 Cuenta bloqueada temporalmente por múltiples intentos fallidos. Intenta nuevamente más tarde.`
- `x-tenant-id` ausente/inválido → `400` (BadRequestException de `parsePositiveId`)

---

### POST /api/v1/auth/refresh

**Propósito:** Rotar un refresh token vigente por un nuevo par access+refresh token.
**Auth:** `@Public()`.
**Headers:** ninguno especial (no requiere `x-tenant-id`; el tenant se re-resuelve desde el refresh token almacenado).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| (ninguno) | — | — |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| (ninguno) | — | — | — | — |

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| refreshToken | string | Sí | trim, min 20 | Refresh token emitido previamente |

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| accessToken | string | Nuevo access token |
| refreshToken | string | Nuevo refresh token (el anterior queda revocado por rotación) |
| tokenType | `'Bearer'` | Constante |
| expiresIn | string | Duración del access token |

**Errores**
- Token no encontrado o expirado → `401 Refresh token inválido o expirado.`
- Credenciales del actor ya no existen → `401 Refresh token inválido.`
- Actor ya no activo/disponible (cliente cerrado, usuario suspendido, rol desconocido) → `401 El actor asociado a este token ya no está disponible.`

---

### POST /api/v1/auth/logout

**Propósito:** Revocar un refresh token (o todos los del actor si `allDevices=true`).
**Auth:** `@Public()` (opera sobre el refresh token mismo, no sobre el access token).
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| (ninguno) | — | — |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| (ninguno) | — | — | — | — |

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| refreshToken | string | Sí | trim, min 20 | Refresh token a revocar |
| allDevices | boolean | No | `false` | Si `true`, revoca todos los refresh tokens del actor y aumenta `tokenVersion` (invalida access tokens ya emitidos de inmediato) |

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| loggedOut | boolean | Siempre `true` (operación idempotente; token ya inválido/inexistente también responde `true`) |

**Errores**
- No lanza errores de negocio; es idempotente por diseño.

---

### POST /api/v1/auth/provision-credentials

**Propósito:** Crear la contraseña inicial de un `internal_user` o `platform_user` ya existente (no hay autoregistro público para estos roles).
**Auth:** Requiere `JwtAuthGuard` (no es `@Public()`) + `@Roles('admin', 'platform_admin')` vía `RolesGuard`. Doble verificación de rol también dentro de `AuthService.provisionCredentials` (defensa en profundidad).
**Headers:** `Authorization: Bearer <access-token>` (rol `admin` o `platform_admin`).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| (ninguno) | — | — |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| (ninguno) | — | — | — | — |

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| actorType | enum | Sí | `internal_user` \| `platform_user` | Tipo de actor al que se le fija contraseña |
| actorId | string | Sí | regex `^[1-9][0-9]*$` | ID del actor destino |
| password | string | Sí | trim, min 10 ("La contraseña debe tener al menos 10 caracteres."), max 128 | Contraseña inicial; además debe pasar `isPasswordStrongEnough` en el servicio |

**Response 201**
| Campo | Tipo | Descripción |
|---|---|---|
| provisioned | boolean | Siempre `true` si la operación tuvo éxito |

**Errores**
- `requestedBy.role` no es `admin`/`platform_admin` → `403 Solo un administrador puede provisionar credenciales.`
- Password no cumple fuerza mínima (`isPasswordStrongEnough`) → `401 La contraseña no cumple el mínimo de seguridad requerido.`
- `actorId` no existe → `401 El actor indicado no existe.`
- Ya existen credenciales para ese actor → `409 CREDENTIALS_ALREADY_PROVISIONED` (ConflictException)

---

## Módulo: InternalAuthController (`src/modules/internal-users/internal-auth.controller.ts`)

Prefijo del controlador: `internal/auth` → rutas bajo `/api/v1/internal/auth/...`.
Guards de clase: `@UseGuards(JwtAuthGuard, InternalPermissionsGuard)`.

### POST /api/v1/internal/auth/login

**Propósito:** Autenticar usuarios internos para el panel administrativo ATLAS (login especializado que además retorna perfil/roles/permisos).
**Auth:** `@Public()`. `InternalPermissionsGuard` no aplica (sin `@InternalPermissions`).
**Headers:** `x-tenant-id` (opcional si `tenantId` viene en el body; se usa como fallback — `body.tenantId ?? tenantIdHeader`).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| (ninguno) | — | — |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| (ninguno) | — | — | — | — |

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| tenantId | string | No | regex `^[1-9][0-9]*$` | Tenant; si se omite, se usa el header `x-tenant-id` |
| email | string | Sí | trim, email válido, max 180, normalizado a minúsculas | Email corporativo |
| password | string | Sí | min 1, max 128 | Contraseña |

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| accessToken | string | JWT del actor `internal_user` |
| refreshToken | string | Refresh token opaco |
| tokenType | `'Bearer'` | Constante |
| expiresIn | string | Duración del access token |
| user.id | string | ID del usuario interno |
| user.tenantId | string | Tenant del usuario |
| user.email | string | Email |
| user.fullName | string | Nombre completo |
| user.name | string | Nombre para mostrar (alias de fullName según mapper) |
| user.userCode | string \| null | Código de usuario |
| user.status | string | Estado (`active`, `invited`, `suspended`, `locked`, `disabled`) |
| user.department | string \| null | Departamento |
| user.jobTitle | string \| null | Cargo |
| user.mustChangePassword | boolean | Si debe cambiar contraseña en próximo login |
| user.mfaEnabled | boolean | Si tiene MFA activo |
| user.roles | string[] | Códigos de roles internos asignados |
| user.legacyRoles | string[] | Roles legacy derivados |
| user.permissions | string[] | Códigos de permisos efectivos |

**Errores**
- Mismos que `AuthService.login` (credenciales inválidas, cuenta bloqueada) → `401`
- `x-tenant-id`/`tenantId` ausente o inválido → `400`
- Si el token emitido no corresponde a un `internal_user` (payload sin `tenantId`/`internalUserId`) → `401 El token emitido no corresponde a un usuario interno.`
- Usuario interno inactivo al recomponer perfil → `401 El usuario interno ya no está activo.`

---

### POST /api/v1/internal/auth/refresh

**Propósito:** Rotar el refresh token de una sesión interna y devolver tokens + perfil actualizado.
**Auth:** `@Public()`.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| (ninguno) | — | — |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| (ninguno) | — | — | — | — |

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| refreshToken | string | Sí | trim, min 20 | Refresh token vigente |

**Response 200**
Igual shape que `POST /internal/auth/login` (tokens + `user.*`, ver tabla arriba).

**Errores**
- Igual que `POST /api/v1/auth/refresh` (401 token inválido/expirado, actor no disponible)
- Payload sin `tenantId`/`internalUserId` → `401 El token emitido no corresponde a un usuario interno.`

---

### POST /api/v1/internal/auth/logout

**Propósito:** Revocar el refresh token de una sesión interna (o todos los dispositivos).
**Auth:** `@Public()`.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| (ninguno) | — | — |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| (ninguno) | — | — | — | — |

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| refreshToken | string | Sí | trim, min 20 | Refresh token a revocar |
| allDevices | boolean | No | `false` | Revoca todas las sesiones del actor y sube `tokenVersion` |

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| loggedOut | boolean | Siempre `true` (idempotente) |

**Errores**
- Ninguno (idempotente).

---

### GET /api/v1/internal/auth/me

**Propósito:** Devolver usuario, roles y permisos efectivos del actor interno autenticado, para renderizar menú dinámico del panel.
**Auth:** `JwtAuthGuard` + `InternalPermissionsGuard` con `@InternalPermissions('auth.internal.me.read')`.
**Headers:** `Authorization: Bearer <access-token>` de un `internal_user` (requiere `tenantId` e `internalUserId` en el payload).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| (ninguno) | — | — |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| (ninguno) | — | — | — | — |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| user.id | string | ID del usuario interno |
| user.tenantId | string | Tenant |
| user.email | string | Email |
| user.fullName | string | Nombre completo |
| user.name | string | Nombre para mostrar |
| user.userCode | string \| null | Código de usuario |
| user.status | string | Estado |
| user.department | string \| null | Departamento |
| user.jobTitle | string \| null | Cargo |
| user.mustChangePassword | boolean | Si debe cambiar contraseña |
| user.mfaEnabled | boolean | Si tiene MFA activo |
| user.roles | string[] | Roles internos |
| user.legacyRoles | string[] | Roles legacy |
| user.permissions | string[] | Permisos efectivos |

**Errores**
- Sesión sin `tenantId`/`internalUserId` → `403 Esta operación requiere una sesión de usuario interno.`
- Usuario ya no `active` → `401 El usuario interno ya no está activo.`
- Falta el permiso `auth.internal.me.read` → `403 El usuario interno no tiene los permisos requeridos para esta operación.`

---

### POST /api/v1/internal/auth/signup

**Propósito:** Crear un nuevo usuario interno (signup controlado desde el panel admin; no es autorregistro público).
**Auth:** `JwtAuthGuard` + `InternalPermissionsGuard` con `@InternalPermissions('internal.users.manage', 'internal.roles.manage')` — requiere **ambos** permisos (lógica AND).
**Headers:** `Authorization: Bearer <access-token>`.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| (ninguno) | — | — |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| (ninguno) | — | — | — | — |

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| tenantId | string | No | regex `^[1-9][0-9]*$` | Debe coincidir con el tenant del actor (si difiere → 403); si se omite, usa el tenant del actor |
| email | string | Sí | trim, email válido, max 180, minúsculas | Email corporativo, único por tenant |
| fullName | string | Sí | trim, min 3, max 180 | Nombre completo |
| userCode | string | No | trim, min 3, max 60 | Si se omite, se deriva del prefijo del email |
| department | enum | No | `OPERATIONS`\|`RISK`\|`COLLECTIONS`\|`COMPLIANCE`\|`FINANCE`\|`SUPPORT`\|`SYSTEMS`\|`AUDIT`\|`EXECUTIVE`; default `OPERATIONS` | Departamento |
| jobTitle | string | No | trim, max 120 | Cargo |
| password | string | Sí | trim, min 10, max 128; además `isPasswordStrongEnough` | Contraseña inicial |
| mustChangePassword | boolean | No | default `true` | Fuerza cambio de contraseña en próximo login |
| roles | string[] | Sí | enum de `INTERNAL_ROLE_CODES`, min 1, max 8, sin duplicados | Roles internos a asignar |
| reason | string | Sí | trim, min 8, max 500 | Motivo para auditoría |

**Response 201**
Mismo shape que `InternalAccessProfile` (`user.*`, igual que `GET /internal/auth/me`).

**Errores**
- Sesión sin `tenantId`/`internalUserId` → `403 Esta operación requiere una sesión de usuario interno.`
- `tenantId` del body distinto al del actor → `403 No puedes crear usuarios internos fuera de tu tenant.`
- Password no cumple fuerza mínima → `401 La contraseña no cumple el mínimo de seguridad requerido.`
- Roles duplicados/no válidos en el enum → `403 Uno o más roles internos no son válidos.`
- Email ya registrado en el tenant → `409 INTERNAL_USER_EMAIL_ALREADY_EXISTS`
- Alguno de los roles solicitados no existe/no está activo en el catálogo → `403 Uno o más roles internos no están activos.`
- Se solicita un rol privilegiado (`SUPER_ADMIN`, `SYSTEMS_ADMIN`, `INTERNAL_IDENTITY_ADMIN`) y el actor no es `SUPER_ADMIN` → `403 Solo SUPER_ADMIN puede asignar roles administrativos críticos.`
- Falta alguno de los permisos `internal.users.manage` / `internal.roles.manage` → `403 El usuario interno no tiene los permisos requeridos para esta operación.`

---

## Módulo: InternalUsersController (`src/modules/internal-users/internal-users.controller.ts`)

Prefijo del controlador: `internal/users` → rutas bajo `/api/v1/internal/users/...`.
Guards de clase: `@UseGuards(JwtAuthGuard, InternalPermissionsGuard)`.

### GET /api/v1/internal/users

**Propósito:** Listar usuarios internos del tenant del actor autenticado.
**Auth:** `@InternalPermissions('internal.users.read')`.
**Headers:** `Authorization: Bearer <access-token>` de sesión interna.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| (ninguno) | — | — |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| (ninguno) | — | — | — | — |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| items | array | Lista de `InternalUserListItem` (mismo shape que `user.*` de `/internal/auth/me`: id, tenantId, email, fullName, name, userCode, status, department, jobTitle, mustChangePassword, mfaEnabled, roles, legacyRoles, permissions) |

No pagina (no hay `meta`/`limit`/`offset`); devuelve todos los usuarios del tenant.

**Errores**
- Sesión sin `tenantId`/`internalUserId` → `403 Esta operación requiere una sesión de usuario interno.`
- Falta permiso `internal.users.read` → `403 El usuario interno no tiene los permisos requeridos para esta operación.`

---

### GET /api/v1/internal/users/:internalUserId

**Propósito:** Consultar el detalle/perfil de un usuario interno específico del tenant.
**Auth:** `@InternalPermissions('internal.users.read')`.
**Headers:** `Authorization: Bearer <access-token>`.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| internalUserId | string (regex `^[1-9][0-9]*$`) | ID del usuario interno a consultar; validado por `internalUserParamsSchema` |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| (ninguno) | — | — | — | — |

**Request body**
Sin body.

**Response 200**
Mismo shape que `InternalAccessProfile.user` (ver `/internal/auth/me`).

**Errores**
- `internalUserId` no cumple el patrón → `400`
- Usuario no encontrado en el tenant del actor → `404 Usuario interno no encontrado.`
- Falta permiso → `403`

---

### PATCH /api/v1/internal/users/:internalUserId

**Propósito:** Editar datos de perfil, departamento, cargo o estado de un usuario interno.
**Auth:** `@InternalPermissions('internal.users.manage')`.
**Headers:** `Authorization: Bearer <access-token>`.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| internalUserId | string (regex `^[1-9][0-9]*$`) | ID del usuario interno a editar |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| (ninguno) | — | — | — | — |

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| fullName | string | No | trim, min 3, max 180 | Nuevo nombre completo |
| department | enum | No | mismos valores que en signup | Nuevo departamento |
| jobTitle | string \| null | No | trim, max 120, nullable | Nuevo cargo (o `null` para limpiar) |
| status | enum | No | `active`\|`invited`\|`suspended`\|`locked`\|`disabled` | Nuevo estado |
| mustChangePassword | boolean | No | — | Forzar cambio de contraseña |
| reason | string | Sí | trim, min 8, max 500 | Motivo, obligatorio siempre (para auditoría) |

**Response 200**
Mismo shape que `InternalAccessProfile.user` (perfil actualizado).

**Errores**
- Sesión sin `tenantId`/`internalUserId` → `403`
- Usuario destino no existe en el tenant → `404 Usuario interno no encontrado.`
- El actor intenta ponerse a sí mismo en `suspended`/`locked`/`disabled` → `403 No puedes suspender, bloquear o desactivar tu propia cuenta interna.`
- `status` es un estado tipo deshabilitado y el actor no tiene `internal.users.manage` → `403 Desactivar, suspender o bloquear usuarios requiere el permiso internal.users.manage.` (chequeo redundante además del guard de ruta)
- Falta permiso `internal.users.manage` (guard de ruta) → `403`

---

### PATCH /api/v1/internal/users/:internalUserId/roles

**Propósito:** Reemplazar completamente el conjunto de roles internos asignados a un usuario.
**Auth:** `@InternalPermissions('internal.users.manage', 'internal.roles.manage')` — requiere **ambos** permisos (AND).
**Headers:** `Authorization: Bearer <access-token>`.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| internalUserId | string (regex `^[1-9][0-9]*$`) | ID del usuario interno cuyos roles se reemplazan |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| (ninguno) | — | — | — | — |

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| roles | string[] | Sí | enum `INTERNAL_ROLE_CODES`, min 1, max 8, sin duplicados | Nuevo conjunto completo de roles |
| reason | string | Sí | trim, min 8, max 500 | Motivo para auditoría |

**Response 200**
Mismo shape que `InternalAccessProfile.user` (perfil con roles ya actualizados, releído tras el reemplazo).

**Errores**
- Sesión sin `tenantId`/`internalUserId` → `403`
- Usuario destino no existe → `404 Usuario interno no encontrado.`
- Roles duplicados/inválidos en el enum → `403 Uno o más roles internos no son válidos.`
- El actor intenta reemplazar sus propios roles → `403 No puedes reemplazar tus propios roles internos desde este endpoint.`
- Algún rol no existe/no está activo en catálogo → `403 Uno o más roles internos no están activos.`
- Se incluye un rol privilegiado (`SUPER_ADMIN`, `SYSTEMS_ADMIN`, `INTERNAL_IDENTITY_ADMIN`) y el actor no es `SUPER_ADMIN` → `403 Solo SUPER_ADMIN puede asignar roles administrativos críticos.`
- Falta alguno de los permisos requeridos → `403`

---

## Módulo: InternalAccessCatalogController (`src/modules/internal-users/internal-access-catalog.controller.ts`)

Prefijo del controlador: `@Controller()` (sin prefijo propio) → rutas literalmente como se declaran en cada método, bajo `/api/v1/...`.
Guards de clase: `@UseGuards(JwtAuthGuard, InternalPermissionsGuard)`.

### GET /api/v1/internal/roles

**Propósito:** Listar el catálogo de roles internos disponibles (con sus permisos agregados).
**Auth:** `@InternalPermissions('internal.roles.read')`.
**Headers:** `Authorization: Bearer <access-token>` de sesión interna.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| (ninguno) | — | — |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| (ninguno) | — | — | — | — |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| items | array | Lista de roles: `{ id, code, name, description, department, legacyRoleCode, status, permissions[] }` |
| items[].id | string | ID del rol |
| items[].code | string | Código único del rol |
| items[].name | string | Nombre visible |
| items[].description | string \| null | Descripción |
| items[].department | string \| null | Departamento asociado |
| items[].legacyRoleCode | string | Código de rol legacy equivalente |
| items[].status | string | Estado del rol |
| items[].permissions | string[] | Códigos de permisos agregados (deduplicados y ordenados) que otorga el rol |

**Errores**
- Sesión sin `tenantId`/`internalUserId` → `403 Esta operación requiere una sesión interna.`
- Falta permiso `internal.roles.read` → `403`

---

### GET /api/v1/internal/roles/:roleId

**Propósito:** Consultar el detalle de un rol interno específico del catálogo.
**Auth:** `@InternalPermissions('internal.roles.read')`.
**Headers:** `Authorization: Bearer <access-token>`.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| roleId | string (regex `^[1-9][0-9]*$`) | ID del rol; validado por `internalRoleParamsSchema` |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| (ninguno) | — | — | — | — |

**Request body**
Sin body.

**Response 200**
Un único objeto rol (mismo shape que un elemento de `items` en `GET /internal/roles`): `{ id, code, name, description, department, legacyRoleCode, status, permissions[] }`.

**Errores**
- `roleId` no cumple el patrón → `400`
- Rol no encontrado → `404 Rol interno no encontrado.`
- Sesión sin `tenantId`/`internalUserId` → `403`
- Falta permiso `internal.roles.read` → `403`

---

### GET /api/v1/internal/permissions

**Propósito:** Listar el catálogo completo de permisos internos disponibles en el sistema RBAC.
**Auth:** `@InternalPermissions('internal.permissions.read')`.
**Headers:** `Authorization: Bearer <access-token>`.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| (ninguno) | — | — |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| (ninguno) | — | — | — | — |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| items | array | Lista de `InternalPermissionListItem` |
| items[].id | string | ID del permiso |
| items[].code | string | Código único (p. ej. `internal.users.manage`) |
| items[].module | string | Módulo al que pertenece |
| items[].resource | string | Recurso sobre el que aplica |
| items[].action | string | Acción (`read`, `manage`, etc.) |
| items[].description | string \| null | Descripción |
| items[].riskLevel | string | Nivel de riesgo del permiso |
| items[].requiresReason | boolean | Si su uso exige campo `reason` en el endpoint que lo consume |
| items[].requiresMfa | boolean | Si requiere MFA activo para ejercerlo |

**Errores**
- Sesión sin `tenantId`/`internalUserId` → `403 Esta operación requiere una sesión interna.`
- Falta permiso `internal.permissions.read` → `403`

---

<a id="modulo-02"></a>

# Contrato HTTP: Customers, Customer Onboarding, Customer Privacy, Customer Telemetry

Prefijo global de todas las rutas: `/api/v1` (`env.API_PREFIX`, por defecto `api/v1`, configurable via `API_PREFIX`).

Notas generales aplicables a todos los endpoints de este documento salvo que se indique lo contrario:

- Todos los controladores usan `@UseGuards(JwtAuthGuard, RolesGuard)` a nivel de clase. `JwtAuthGuard` exige un JWT válido en `Authorization: Bearer <token>` salvo que el endpoint tenga `@Public()`. `RolesGuard` exige que el rol del usuario autenticado (`currentUser.role`) esté en la lista de `@Roles(...)` aplicable (a nivel de método o de clase); si no hay ningún `@Roles` aplicable, cualquier usuario autenticado pasa.
- El header `x-tenant-id` se parsea con `parsePositiveId`, que exige un entero positivo en texto (`^[1-9][0-9]*$`); si falta o es inválido lanza `BadRequestException` (400). En `customers.controller.ts` se usa como fallback `currentUser.tenantId` si el header no viene.
- Muchos endpoints de escritura exigen el header `x-idempotency-key`; si falta, se lanza `BadRequestException` (400) con mensaje `X-Idempotency-Key header is required.` Adicionalmente existe un `IdempotencyInterceptor` global (fuera del alcance de estos controladores) que deduplica reintentos exactos por esa misma clave sobre la tabla `idempotency_keys`.
- Los `customerId` de path siempre se validan con un schema Zod `^[1-9][0-9]*$` (IDs numéricos en texto).
- La autorización de "propio recurso" se centraliza en dos helpers:
  - `assertOwnCustomerResource(currentUser, customerId)`: lanza `ForbiddenException` (403) si `currentUser.role === 'customer'` y `currentUser.customerId !== customerId`. Roles internos (operador, analista, admin, etc.) pasan siempre.
  - `assertCustomerOnboardingScope(customerId, currentUser)` (solo en customer-onboarding): igual, pero además permite explícitamente cualquier rol interno operacional (`isInternalOperationalRole`).
- Los mensajes de error de negocio se devuelven como el `message` del cuerpo de error estándar de Nest (`{ statusCode, message, error }`), gestionado por el filtro global de excepciones.

---

## Módulo: Customers (`src/modules/customers/customers.controller.ts`)

Prefijo de controlador: `customers` → rutas bajo `/api/v1/customers`.

### GET /api/v1/customers/:customerId/me

**Propósito:** Obtener el perfil consolidado de autoservicio del cliente autenticado (datos personales, contactos, consentimientos, riesgo y siguiente paso sugerido).
**Auth:** JWT requerido (`JwtAuthGuard`). `RolesGuard` aplica pero no hay `@Roles` explícito en este método ni en la clase → cualquier rol autenticado pasa el guard de roles; sin embargo el servicio exige que sea el propio cliente (ver `assertOwnCustomerResource`) salvo que el actor no sea `customer`.
**Headers:** `authorization: Bearer <jwt>` (requerido); `x-tenant-id` (opcional — si falta, se usa `currentUser.tenantId`).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| customerId | string (regex `^[1-9][0-9]*$`) | ID numérico del cliente, validado por `customerIdParamsSchema`. |

**Query params**

Ninguno.

**Request body**

Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| customer.customerId | string | ID del cliente. |
| customer.customerCode | string \| null | Código público del cliente. |
| customer.status | string \| null | `lifecycleStatus` del cliente (ej. `registered`, `pending_review`, `approved`, `blocked`). |
| customer.phoneLast4 | string \| null | Últimos 4 dígitos del teléfono primario. |
| customer.emailDomain | string \| null | Dominio del email primario. |
| profile | object \| null | `null` si no hay versión de perfil vigente. |
| profile.firstName | string \| null | Nombre. |
| profile.lastName | string \| null | Apellido. |
| profile.birthDate | string \| null | Fecha de nacimiento (`YYYY-MM-DD`). |
| profile.preferredLanguage | string \| null | Idioma preferido. |
| onboarding | null | Siempre `null` — bloqueado: la tabla `onboarding_flows` aún no está expuesta aquí (ver comentario `BLOCKED` en `customers.mapper.ts`). |
| contacts | array | Lista de métodos de contacto del cliente. |
| contacts[].contactType | string \| null | `phone` \| `email`. |
| contacts[].status | string \| null | `verified` \| `unverified` \| null. |
| contacts[].isPrimary | boolean \| null | Si es el contacto primario. |
| contacts[].valueLast4 | string \| null | Últimos caracteres del valor (solo aplica a teléfono). |
| consents.accepted | string[] | `purposeCode` de consentimientos con `granted === true`. |
| consents.declined | string[] | `purposeCode` de consentimientos con `granted === false`. |
| risk | object \| null | `null` si no hay evaluación de riesgo. |
| risk.latestDecision | string \| null | `recommendedAction` de la última evaluación. |
| risk.latestRiskLevel | string \| null | Nivel de riesgo de la última evaluación. |
| nextStep | string | Uno de: `blocked`, `pending_review`, `complete`, `verify_contact`, `identity_capture` — derivado en `deriveNextStep()` según `lifecycleStatus` y estado de contactos. |

**Errores**
- `x-tenant-id` ausente y sin `currentUser.tenantId`, o valor no numérico positivo → `BadRequestException` (400).
- Cliente autenticado con rol `customer` pidiendo el `customerId` de otro cliente → `ForbiddenException` (403), vía `assertOwnCustomerResource`.
- Cliente no existe en el tenant → `NotFoundException` (404), mensaje `Cliente no encontrado.`

---

## Módulo: Customer Onboarding (`src/modules/customer-onboarding/customer-onboarding.controller.ts`)

Prefijo de controlador: `customer-onboarding` → rutas bajo `/api/v1/customer-onboarding`.

### POST /api/v1/customer-onboarding/start

**Propósito:** Registrar un nuevo cliente y arrancar su flujo de onboarding (crea cliente, perfil, contactos, dispositivo, sesión, consentimientos y flujo de onboarding en una sola transacción).
**Auth:** `@Public()` — no requiere JWT. Throttling explícito: 10 intentos por minuto por IP (`@Throttle`).
**Headers:** `x-tenant-id` (requerido, entero positivo); `x-idempotency-key` (requerido); `x-client-channel` (opcional, leído pero no usado actualmente en el body/servicio).

**Path params**

Ninguno.

**Query params**

Ninguno.

**Request body** (`startOnboardingSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| customer.phone | string | condicional | trim, min 6, max 40 | Teléfono; se exige phone o email (refine). |
| customer.email | string | condicional | trim, formato email, max 180 | Email; se exige phone o email. |
| customer.firstName | string | no | trim, min 1, max 120 | Nombre. |
| customer.lastName | string | no | trim, min 1, max 120 | Apellido. |
| customer.birthDate | string | no | regex `YYYY-MM-DD` | Fecha de nacimiento. |
| password | string | no | trim, min 10, max 128 | Contraseña opcional para crear credenciales de auth del cliente; si se omite, el cliente queda sin poder autenticarse por password. |
| consents | array | sí | min 1 elemento | Lista de decisiones de consentimiento. |
| consents[].consentDocumentId | string | sí | regex `^[1-9][0-9]*$` | ID del documento de consentimiento; debe existir y estar activo/publicado. |
| consents[].purposeCode | string | sí | trim, min 1, max 80 | Código del propósito. |
| consents[].granted | boolean | sí | — | Debe ser `true`; si algún consentimiento viene con `granted:false`, se rechaza toda la solicitud (`REQUIRED_CONSENT_MISSING`). |
| consents[].acceptedAt | string | no | ISO datetime | Momento de aceptación; default `now`. |
| device.deviceFingerprintHash | string | sí | trim, min 32, max 128 | Hash de huella de dispositivo. |
| device.fingerprintVersion | string | no | trim, min 1, max 40 | Default `'v1'`. |
| device.channel | string enum | sí | `mobile_app` \| `web_app` | Canal del dispositivo. |
| device.userAgent | string | no | trim, max 500 | User agent. |
| device.snapshot | object | no | — | Metadatos de dispositivo (ver abajo). |
| device.snapshot.brand/model/osFamily/osVersion/appVersion/timezone/locale | string | no | tamaños variables (max 40-120) | Metadatos de hardware/SO. |
| device.snapshot.isRooted/isEmulator/vpnDetected | boolean | no | — | Señales de riesgo del dispositivo. |
| permissions | array | no | — | Decisiones de permisos del dispositivo. |
| permissions[].permissionCode | string enum | sí | `location`,`camera`,`contacts`,`notifications`,`storage` | Código de permiso. |
| permissions[].granted | boolean | sí | — | Si se concedió. |
| permissions[].decidedAt | string | no | ISO datetime | Momento de decisión; default `now`. |
| onboarding.sourceType | string | no | trim, min 1, max 40 | Default `'mobile_app'`. |
| onboarding.startedStepCode | string | no | trim, min 1, max 80 | Código del primer paso registrado. |

**Response 201**
| Campo | Tipo | Descripción |
|---|---|---|
| customerId | string | ID del cliente creado. |
| customerCode | string \| null | Código público generado (`createStableCode('CUS')`). |
| lifecycleStatus | string \| null | Siempre `'registered'` al crear. |
| onboardingFlowId | string \| null | Siempre `null` actualmente (bloqueado — ver comentario en `customer-onboarding.mapper.ts`; la tabla existe internamente pero no se expone en la respuesta). |
| sessionId | string | ID de la sesión creada. |
| deviceId | string | ID del dispositivo (tenant-scoped) creado o reutilizado. |
| nextStep | string | Siempre `'verify_contact'`. |

**Errores**
- Falta `x-tenant-id` válido → `BadRequestException` (400).
- Falta `x-idempotency-key` → `BadRequestException` (400).
- Ya existe un cliente con el mismo hash de teléfono/email en el tenant (chequeo previo o colisión de índice único bajo concurrencia) → `ConflictException` (409), mensaje `CUSTOMER_ALREADY_EXISTS`.
- Algún `consentDocumentId` no existe, no está publicado o no está activo, o algún consentimiento llega con `granted:false` → `UnprocessableEntityException` (422), mensaje `REQUIRED_CONSENT_MISSING` o `Consent document {id} not found, not published, or not active.`
- Body inválido según Zod → 400 (vía `ZodValidationPipe`).
- Rate limit de 10/min por IP excedido → 429 (`ThrottlerException`, manejado por el guard global de throttling).

---

### POST /api/v1/customer-onboarding/:customerId/contact-verification/request

**Propósito:** Solicitar el envío de un código de verificación (OTP) para un contacto (teléfono o email) del cliente.
**Auth:** JWT + `@Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')`.
**Headers:** `authorization` (requerido); `x-tenant-id` (requerido); `x-idempotency-key` (requerido).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| customerId | string (regex `^[1-9][0-9]*$`) | ID del cliente. |

**Query params**

Ninguno.

**Request body** (`contactVerificationRequestSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| contactType | string enum | sí | `phone` \| `email` | Tipo de contacto a verificar. |
| verificationChannel | string enum | sí | `sms` \| `email` \| `whatsapp` | Canal de envío del código. |
| sessionId | string | no | regex `^[1-9][0-9]*$` | Sesión asociada. |

**Response 202**
| Campo | Tipo | Descripción |
|---|---|---|
| verificationAttemptId | string | ID del intento de verificación creado. |
| contactType | string | Eco de `contactType` enviado. |
| deliveryStatus | string | Siempre `'accepted'`. |
| expiresAt | string (ISO datetime) | `now + 10 minutos`, momento de expiración del código. |

**Errores**
- Falta `x-idempotency-key` → `BadRequestException` (400).
- Cliente autenticado (`role='customer'`) distinto al `customerId` del path y sin rol interno → `ForbiddenException` (403), vía `assertCustomerOnboardingScope`.
- Cliente no existe → `NotFoundException` (404), `Cliente no encontrado.`
- `customer.lifecycleStatus === 'blocked'` → `UnprocessableEntityException` (422), `CUSTOMER_BLOCKED`.
- No existe un método de contacto de ese tipo para el cliente → `UnprocessableEntityException` (422), `CONTACT_NOT_REGISTERED`.
- El contacto ya está verificado → `ConflictException` (409), `CONTACT_ALREADY_VERIFIED`.
- Se solicitó un nuevo código hace menos de 30 segundos → `ConflictException` (409), `VERIFICATION_RATE_LIMITED`.

---

### POST /api/v1/customer-onboarding/:customerId/contact-verification/submit

**Propósito:** Enviar el código OTP recibido para completar la verificación de un contacto.
**Auth:** JWT + `@Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')`.
**Headers:** `authorization` (requerido); `x-tenant-id` (requerido); `x-idempotency-key` (requerido).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| customerId | string (regex `^[1-9][0-9]*$`) | ID del cliente. |

**Query params**

Ninguno.

**Request body** (`contactVerificationSubmitSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| contactType | string enum | sí | `phone` \| `email` | Tipo de contacto. |
| verificationChannel | string enum | sí | `sms` \| `email` \| `whatsapp` | Canal usado. |
| verificationCode | string | sí | trim, min 4, max 12 | Código OTP recibido por el usuario. Nota: en el entorno actual (proveedor OTP real pendiente), solo el valor de prueba `123456` es aceptado. |
| sessionId | string | no | regex `^[1-9][0-9]*$` | Sesión asociada. |

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| customerId | string | Eco del `customerId` del path. |
| contactType | string | Eco de `contactType` enviado. |
| verificationStatus | string | Siempre `'verified'` en caso de éxito. |
| nextStep | string | Siempre `'identity_capture'`. |

**Errores**
- Falta `x-idempotency-key` → `BadRequestException` (400).
- Actor sin permiso sobre el `customerId` → `ForbiddenException` (403).
- Cliente no existe → `NotFoundException` (404).
- No existe método de contacto de ese tipo → `UnprocessableEntityException` (422), `CONTACT_NOT_REGISTERED`.
- Contacto ya verificado → `ConflictException` (409), `CONTACT_ALREADY_VERIFIED`.
- No hay intento de verificación previo (nunca se llamó a `/request`) → `NotFoundException` (404), `VERIFICATION_ATTEMPT_NOT_FOUND`.
- El intento tiene más de 10 minutos → marca el intento como `expired` y lanza `UnauthorizedException` (401), `VERIFICATION_CODE_EXPIRED`.
- Código incorrecto (`!== '123456'`) → marca el intento `failed` y lanza `UnauthorizedException` (401), `INVALID_VERIFICATION_CODE`.

---

### POST /api/v1/customer-onboarding/:customerId/identity-package

**Propósito:** Enviar el paquete de evidencias de identidad (KYC) del cliente (documento + selfie/otros) para revisión.
**Auth:** JWT + `@Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')`.
**Headers:** `authorization` (requerido); `x-tenant-id` (requerido); `x-idempotency-key` (requerido).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| customerId | string (regex `^[1-9][0-9]*$`) | ID del cliente. |

**Query params**

Ninguno.

**Request body** (`identityPackageSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| identity.documentType | string enum | sí | `ci` \| `passport` \| `foreign_id` | Tipo de documento de identidad. |
| identity.documentNumberHash | string | sí | trim, min 32, max 128 | Hash del número de documento (nunca en claro). |
| identity.documentLast4 | string | sí | trim, min 2, max 4 | Últimos dígitos del documento. |
| identity.countryCode | string | no | trim, length 3 | Default `'BOL'`. |
| identity.issuedIn | string | no | trim, max 60 | Lugar de emisión. |
| identity.issuedAt | string | no | regex `YYYY-MM-DD` | Fecha de emisión. |
| identity.expiresAt | string | no | regex `YYYY-MM-DD` | Fecha de expiración. |
| evidence | array | sí | min 1, max 5 elementos | Lista de evidencias (archivos ya subidos a storage). |
| evidence[].evidenceType | string enum | sí | `identity_front`,`identity_back`,`selfie`,`proof_of_address`,`other` | Tipo de evidencia. Se exige al menos una `identity_front` (si no, `REQUIRED_EVIDENCE_MISSING`). |
| evidence[].storageKey | string | sí | trim, min 8, max 500, no puede empezar con `data:` | Referencia al archivo en storage (no se acepta base64 inline). |
| evidence[].mimeType | string enum | sí | `image/jpeg`,`image/png`,`application/pdf` | Tipo MIME. |
| evidence[].sha256Hash | string | sí | trim, min 32, max 128 | Hash del contenido del archivo. |
| evidence[].fileSizeBytes | string | no | regex `^[1-9][0-9]*$` | Tamaño en bytes como texto. |
| provider.providerCode | string | no | trim, min 1, max 80 | Código de proveedor externo de verificación (si se usó uno). |
| provider.requestPayloadHash | string | no | trim, min 32, max 128 | Hash del payload enviado al proveedor. |
| sessionId | string | no | regex `^[1-9][0-9]*$` | Sesión asociada. |

**Response 202**
| Campo | Tipo | Descripción |
|---|---|---|
| customerId | string | Eco del `customerId` del path. |
| identityVerificationAttemptId | string | ID del intento de verificación de identidad creado. |
| status | string | Siempre `'pending_review'`. |
| nextStep | string | Siempre `'risk_evaluation'`. |

Efecto secundario: el `lifecycleStatus` del cliente pasa a `pending_identity_review`.

**Errores**
- Falta `x-idempotency-key` → `BadRequestException` (400).
- Actor sin permiso sobre el `customerId` → `ForbiddenException` (403).
- Cliente no existe → `NotFoundException` (404).
- No se envió evidencia de tipo `identity_front` → `UnprocessableEntityException` (422), `REQUIRED_EVIDENCE_MISSING`.

---

### POST /api/v1/customer-onboarding/:customerId/address-package

**Propósito:** Registrar/actualizar la dirección declarada del cliente y, opcionalmente, una observación GPS asociada.
**Auth:** JWT + `@Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')`.
**Headers:** `authorization` (requerido); `x-tenant-id` (requerido); `x-idempotency-key` (requerido).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| customerId | string (regex `^[1-9][0-9]*$`) | ID del cliente. |

**Query params**

Ninguno.

**Request body** (`addressPackageSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| address.countryCode | string | no | trim, length 3 | Default `'BOL'`. |
| address.department | string | sí | trim, min 1, max 80 | Departamento. |
| address.city | string | sí | trim, min 1, max 120 | Ciudad. |
| address.zone | string | no | trim, max 120 | Zona. |
| address.addressLineEncrypted | string | no | trim, max 500 | Línea de dirección (se espera cifrada/preprocesada por el cliente); se hashea internamente para `normalizedAddressText`. |
| address.referenceEncrypted | string | no | trim, max 500 | Referencia adicional. |
| gpsObservation.lat | number | condicional (si se envía `gpsObservation`) | min -90, max 90 | Latitud. |
| gpsObservation.lng | number | condicional | min -180, max 180 | Longitud. |
| gpsObservation.accuracyMeters | number | no | positive, max 10000 | Precisión en metros. |
| gpsObservation.capturedAt | string | no | ISO datetime | Momento de captura; default `now`. |
| sessionId | string | no | regex `^[1-9][0-9]*$` | Sesión asociada. |

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| customerId | string | Eco del `customerId` del path. |
| addressId | string | ID del registro de dirección (`home`), nuevo o reutilizado. |
| addressVersionId | string | ID de la nueva versión de dirección creada. |
| status | string | Siempre `'recorded'`. |
| nextStep | string | Siempre `'risk_evaluation'`. |

**Errores**
- Falta `x-idempotency-key` → `BadRequestException` (400).
- Actor sin permiso sobre el `customerId` → `ForbiddenException` (403).
- Cliente no existe → `NotFoundException` (404).

---

## Módulo: Customer Privacy (`src/modules/customer-privacy/customer-privacy.controller.ts`)

Prefijo de controlador: `customers/:customerId/privacy` → rutas bajo `/api/v1/customers/:customerId/privacy`.
`@Roles('customer', 'internal_operator', 'compliance_analyst', 'admin', 'platform_admin')` se aplica a nivel de clase (ambos endpoints).

### POST /api/v1/customers/:customerId/privacy/consent-decisions

**Propósito:** Registrar en lote decisiones de consentimiento (otorgar/rechazar/revocar) del cliente sobre uno o más propósitos.
**Auth:** JWT + `@Roles('customer', 'internal_operator', 'compliance_analyst', 'admin', 'platform_admin')`.
**Headers:** `authorization` (requerido); `x-tenant-id` (requerido); `x-idempotency-key` (requerido); `x-client-channel` (opcional, default `'mobile_app'` si falta).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| customerId | string (regex `^[1-9][0-9]*$`) | ID del cliente. |

**Query params**

Ninguno.

**Request body** (`consentDecisionsSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| decisions | array | sí | min 1, max 20 elementos | Lista de decisiones a procesar. |
| decisions[].consentDocumentId | string | sí | regex `^[1-9][0-9]*$` | Debe referenciar un documento de consentimiento activo. |
| decisions[].purposeCode | string | sí | trim, min 1, max 80 | Código de propósito. |
| decisions[].decision | string enum | sí | `granted` \| `declined` \| `revoked` | Decisión tomada. |
| decisions[].decidedAt | string | no | ISO datetime | Momento de la decisión; default `now`. |
| decisions[].sessionId | string | no | regex `^[1-9][0-9]*$` | Sesión asociada. |

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| customerId | string | Eco del `customerId` del path. |
| processed | number | Cantidad de decisiones procesadas. |
| currentConsentStatus | string | `'requires_review'` si alguna decisión fue `revoked`, si no `'complete'`. |

Efectos secundarios: si hay al menos una revocación, se registra un evento de cambio de estado del cliente (`reasonCode: 'consent_revoked'`), aunque `lifecycleStatus` no cambia automáticamente (queda igual, solo se deja constancia para revisión operativa).

**Errores**
- Falta `x-idempotency-key` → `BadRequestException` (400).
- Actor `customer` distinto al `customerId` del path → `ForbiddenException` (403), vía `assertOwnCustomerResource`.
- Cliente no existe → `NotFoundException` (404).
- Algún `consentDocumentId` no existe o no está activo → `UnprocessableEntityException` (422), mensaje `CONSENT_DOCUMENT_NOT_ACTIVE`.

---

### POST /api/v1/customers/:customerId/privacy/data-subject-requests

**Propósito:** Crear una solicitud formal de titular de datos (acceso, rectificación, eliminación, portabilidad, revocación o restricción), con vencimiento a 15 días.
**Auth:** JWT + `@Roles('customer', 'internal_operator', 'compliance_analyst', 'admin', 'platform_admin')`.
**Headers:** `authorization` (requerido); `x-tenant-id` (requerido); `x-idempotency-key` (requerido).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| customerId | string (regex `^[1-9][0-9]*$`) | ID del cliente. |

**Query params**

Ninguno.

**Request body** (`dataSubjectRequestSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| requestType | string enum | sí | `access`,`rectification`,`deletion`,`portability`,`revocation`,`restriction` | Tipo de solicitud. |
| description | string | no | trim, min 5, max 1000 | Descripción libre de la solicitud. |

**Response 201**
| Campo | Tipo | Descripción |
|---|---|---|
| dataSubjectRequestId | string | ID de la solicitud creada. |
| status | string | Siempre `'received'`. |

Nota interna: la solicitud se crea con `requestCode` generado (`createStableCode('DSR')`) y `dueAt = now + 15 días`, pero ninguno de estos dos campos se devuelve en la respuesta actual.

**Errores**
- Falta `x-idempotency-key` → `BadRequestException` (400).
- Actor `customer` distinto al `customerId` del path → `ForbiddenException` (403).
- Cliente no existe → `NotFoundException` (404).

---

## Módulo: Customer Telemetry (`src/modules/customer-telemetry/customer-telemetry.controller.ts`)

Prefijo de controlador: `customers/:customerId/telemetry` → rutas bajo `/api/v1/customers/:customerId/telemetry`.
`@Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')` se aplica a nivel de clase.

### POST /api/v1/customers/:customerId/telemetry/batch

**Propósito:** Ingerir en lote eventos de telemetría del dispositivo/app del cliente durante onboarding (interacciones de formulario, permisos, eventos de auth, riesgo de dispositivo, observaciones SIM/IP, acciones del cliente) y métricas calculadas en el dispositivo.
**Auth:** JWT + `@Roles('customer', 'internal_operator', 'risk_analyst', 'admin', 'platform_admin')`.
**Headers:** `authorization` (requerido); `x-tenant-id` (requerido); `x-idempotency-key` (requerido).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| customerId | string (regex `^[1-9][0-9]*$`) | ID del cliente. |

**Query params**

Ninguno.

**Request body** (`telemetryBatchSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| sessionId | string | sí | regex `^[1-9][0-9]*$` | Sesión del cliente asociada al batch. |
| deviceId | string | sí | regex `^[1-9][0-9]*$` | Dispositivo (tenant-scoped) que originó el batch; si el actor es `customer`, debe estar vinculado al cliente. |
| clientBatchId | string | sí | trim, min 3, max 120 | ID de batch generado por el cliente (idempotencia lógica de negocio; se devuelve tal cual). |
| capturedFrom | string | sí | ISO datetime | Inicio de la ventana de captura. |
| capturedUntil | string | sí | ISO datetime | Fin de la ventana de captura. |
| events | array | no | max 100, default `[]` | Lista de eventos de telemetría. |
| events[].eventType | string enum | sí | `form_field_interaction`,`permission_event`,`auth_event`,`device_risk_event`,`sim_observation`,`ip_reputation_observation`,`customer_observation`,`customer_action`,`onboarding_step_event` | Determina en qué tabla/entidad se persiste el evento. |
| events[].eventCode | string | sí | trim, min 1, max 120 | Código específico del evento. |
| events[].occurredAt | string | sí | ISO datetime | Momento del evento. |
| events[].metadata | object (record) | no | — | Metadatos libres; se interpreta de forma distinta según `eventType` (ej. `interactionType`, `usedCopyPaste`, `corrections`, `durationMs`, `granted`, `loginSuccessful`, `failureReasonCode`, `reasonCode`, `screenName`, `eventType`). No debe contener claves/valores que sugieran contactos crudos del dispositivo (ver validación abajo). |
| onDeviceMetrics | array | no | max 100, default `[]` | Métricas calculadas en el dispositivo. |
| onDeviceMetrics[].metricCode | string | sí | trim, min 1, max 120 | Código de métrica. |
| onDeviceMetrics[].value | number \| string \| boolean \| object | sí | number finito, o string max 500, o boolean, o record | Valor de la métrica. |
| onDeviceMetrics[].computedAt | string | no | ISO datetime | Momento de cálculo. |
| onDeviceMetrics[].confidenceScore | number | no | min 0, max 1 | Confianza del cálculo. |

**Response 202**
| Campo | Tipo | Descripción |
|---|---|---|
| batchId | string | Eco de `clientBatchId`. |
| acceptedEvents | number | Cantidad de eventos procesados de `events`. |
| acceptedMetrics | number | Cantidad de métricas procesadas de `onDeviceMetrics`. |
| duplicatesIgnored | number | Siempre `0` actualmente (no hay deduplicación lógica implementada más allá del interceptor global de idempotencia). |
| status | string | Siempre `'accepted'`. |

**Errores**
- Falta `x-idempotency-key` → `BadRequestException` (400).
- Actor `customer` distinto al `customerId` del path → `ForbiddenException` (403), vía `assertOwnCustomerResource`.
- `events` y `onDeviceMetrics` ambos vacíos → `BadRequestException` (400), `El batch debe incluir al menos un evento o métrica.`
- Payload serializado mayor a 250.000 caracteres → `PayloadTooLargeException` (413), `PAYLOAD_TOO_LARGE`.
- Metadata contiene indicios de datos crudos de contactos del dispositivo (`rawcontacts`, `contactlist`, `phonebook`, `agenda` en cualquier parte del JSON) → `UnprocessableEntityException` (422), `RAW_CONTACTS_NOT_ALLOWED`.
- Cliente no existe → `NotFoundException` (404).
- `deviceId` no vinculado al cliente y el actor es `role==='customer'` → `ForbiddenException` (403), `El dispositivo no está vinculado al cliente.` (Nota: para roles internos, esta validación se omite y el batch se acepta igual.)

---

<a id="modulo-03"></a>

# Contrato HTTP — Consents, Sessions, Risk, External Data

Prefijo global de todas las rutas: `/api/v1` (variable `env.API_PREFIX`, default `api/v1`, configurado en `main.ts` vía `app.setGlobalPrefix(env.API_PREFIX)`).

Notas transversales:

- No hay `JwtAuthGuard`/`RolesGuard` registrados como guard global (`APP_GUARD`) en `app.module.ts` — solo `ThrottlerGuard` es global. Cada controlador de este documento aplica `@UseGuards(JwtAuthGuard, RolesGuard)` explícitamente a nivel de clase, salvo que se indique `@Public()` en el método.
- `JwtAuthGuard` espera header `Authorization: Bearer <jwt>`. El payload decodificado (`AuthenticatedUser`) tiene: `sub`, `tenantId?`, `customerId?`, `internalUserId?`, `platformUserId?`, `role` (`customer|internal_operator|risk_analyst|compliance_analyst|fraud_analyst|system|system_admin|qa_engineer|devops|readonly_auditor|merchant|admin|platform_admin`), `tokenVersion?`.
- Header `x-tenant-id` se valida con `parsePositiveId`: debe ser un entero positivo representado como string (regex `^[1-9][0-9]*$`); si falta o es inválido lanza `BadRequestException` (400) con mensaje `"x-tenant-id debe ser un entero positivo representado como texto."`. En `external-data` el helper `tenantIdFromHeader` intenta primero el header y si falta usa `currentUser.tenantId` como fallback antes de validar.
- Cuando un endpoint acepta `:customerId` (path, query o body), se aplica `assertOwnCustomerResource(currentUser, customerId)`: si `currentUser.role === 'customer'` y `currentUser.customerId !== customerId`, lanza `ForbiddenException` (403) — "El token del cliente no corresponde al recurso solicitado." Roles internos pueden operar sobre cualquier `customerId`.
- Header `x-idempotency-key` es obligatorio en endpoints de escritura de `sessions` y `risk` (falta → `BadRequestException` 400 "X-Idempotency-Key header is required."). En `external-data`, el header se acepta pero no siempre es obligatorio a nivel de controller; cuando se reutiliza la misma clave con un scope distinto (tenant/provider/customer/queryType/purpose/decisionStage/payload), `executeExternalDataRequest` lanza `BadRequestException` 400 con body `{ code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST', message, providerCode, existingRequestId, mismatches }`.
- Todos los IDs de entidad viajan como **strings** que representan enteros positivos (`^[1-9][0-9]*$` o `^\d+$` según el schema), nunca como `number` en el contrato HTTP.

---

## Módulo: Consents (`src/modules/consents/consents.controller.ts`)

`@Controller()` sin prefijo propio → rutas montadas directamente bajo `/api/v1`.

### GET /api/v1/consent-documents/active

**Propósito:** Listar los documentos de consentimiento (términos, políticas, etc.) vigentes y publicados para un idioma/propósito dado, típicamente para mostrarlos antes de un flujo de onboarding.
**Auth:** `@Public()` — no requiere JWT. Aun así declara `@UseGuards(JwtAuthGuard, RolesGuard)` a nivel de clase, pero `@Public()` en el método hace que `JwtAuthGuard` omita la validación del token.
**Headers:** `x-tenant-id` (requerido, entero positivo como string).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| (ninguno) | | |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| `language` | string (trim, min 2, max 10) | No | `"es"` | Idioma del documento. |
| `purposeCode` | string (trim, min 1, max 80) | No | — | Filtra por `documentCode` (nombre del campo reutilizado; no filtra por propósito real de negocio, ver nota). |

Nota: el schema documenta explícitamente que `channel`/`countryCode` no existen como columnas en `consent_documents` — cualquier parámetro adicional de esa naturaleza es ignorado si se envía.

**Request body**
Sin body.

**Response 200**
Array de `ConsentDocumentResponseDto`:
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | string | ID del documento. |
| `tenantId` | string | Tenant propietario. |
| `documentCode` | string \| null | Código del documento. |
| `versionCode` | string \| null | Versión del documento. |
| `language` | string \| null | Idioma. |
| `contentUrl` | string \| null | URL del contenido publicado. |
| `contentHash` | string \| null | Hash de integridad del contenido. |
| `requiresExplicitAction` | boolean \| null | Si requiere aceptación explícita del usuario. |
| `effectiveFrom` | string (ISO) \| null | Inicio de vigencia. |
| `effectiveUntil` | string (ISO) \| null | Fin de vigencia. |
| `status` | string \| null | Siempre `"published"` para los resultados de este endpoint (filtro fijo en el repositorio). |

**Errores**
- `x-tenant-id` ausente/no numérico → `BadRequestException` (400).
- Query inválida (idioma fuera de rango, `purposeCode` > 80 chars, etc.) → 400 por `ZodValidationPipe`.
- No lanza `NotFoundException`: si no hay documentos activos, devuelve `[]`.

---

## Módulo: Sessions (`src/modules/sessions/sessions.controller.ts`)

Dos controllers en el mismo archivo: `CustomerSessionsController` (`@Controller('customers/:customerId')`) y `OperationsSessionsController` (`@Controller('operations/sessions')`).

### POST /api/v1/customers/:customerId/sessions/start

**Propósito:** Iniciar una nueva sesión de cliente (login/app open), registrando dispositivo, huella, GPS, permisos y señales de riesgo iniciales.
**Auth:** `JwtAuthGuard`, `RolesGuard`. `@Roles('customer','internal_operator','risk_analyst','compliance_analyst','fraud_analyst','admin','platform_admin','system')`. Además `assertOwnCustomerResource` restringe a clientes a su propio `customerId`.
**Headers:** `x-tenant-id` (requerido), `x-idempotency-key` (requerido, 400 si falta), `user-agent` (opcional, se usa como fallback si `device.userAgent` no viene en el body).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| `customerId` | string (`^[1-9][0-9]*$`) | ID del cliente dueño de la sesión. |

**Query params**
Ninguno.

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| `device.deviceFingerprintHash` | string | Sí | trim, min 8, max 180 | Huella única del dispositivo. |
| `device.fingerprintVersion` | string | No | trim, min 1, max 60, default `"v1"` | Versión del algoritmo de fingerprint. |
| `device.channel` | enum | No | `mobile_app`\|`web_app`\|`operations_panel`\|`system`, default `mobile_app` | Canal de origen. |
| `device.userAgent` | string | No | trim, max 1000 | User agent del dispositivo. |
| `device.snapshot` | object | No | ver abajo (`strict`) | Snapshot de estado del dispositivo. |
| `device.snapshot.brand` | string | No | max 100 | Marca del dispositivo. |
| `device.snapshot.model` | string | No | max 160 | Modelo. |
| `device.snapshot.osFamily` | string | No | max 40 | Familia de SO. |
| `device.snapshot.osVersion` | string | No | max 80 | Versión de SO. |
| `device.snapshot.appVersion` | string | No | max 80 | Versión de la app. |
| `device.snapshot.isRooted` | boolean | No | — | Root detectado. |
| `device.snapshot.isEmulator` | boolean | No | — | Emulador detectado. |
| `device.snapshot.vpnDetected` | boolean | No | — | VPN detectada. |
| `authMethod` | string | No | trim, min 1, max 60, default `"app_session"` | Método de autenticación usado. |
| `sessionTokenHash` | string | No | trim, max 128 | Hash del token de sesión; si se omite, se deriva con SHA-256 de `customerId:deviceFingerprintHash:idempotencyKey:timestamp`. |
| `gpsObservation` | object | No | `strict` | Observación GPS al iniciar sesión. |
| `gpsObservation.lat` | number (coerce) | Sí (si se envía el objeto) | -90..90 | Latitud. |
| `gpsObservation.lng` | number (coerce) | Sí | -180..180 | Longitud. |
| `gpsObservation.accuracyMeters` | number (coerce) | No | 0..10000 | Precisión en metros. |
| `gpsObservation.capturedAt` | string (datetime ISO) | No | — | Momento de captura. |
| `permissions` | array de permisos | No | max 30, default `[]` | Ver forma de `permissionDecision` abajo. |
| `permissions[].permissionCode` | string | Sí | trim, min 1, max 80 | Código del permiso (p.ej. `location`). |
| `permissions[].granted` | boolean | Sí | — | Si fue concedido. |
| `permissions[].decidedAt` | string (datetime) | No | — | Momento de la decisión. |
| `locationPermissionGranted` | boolean | No | — | Atajo explícito; si es `true`, se asume permiso de ubicación concedido sin buscar en `permissions`. |
| `simObservation` | object | No | `strict` | Observación de SIM. |
| `simObservation.phoneNumberHash` | string | No | max 128 | Hash del número. |
| `simObservation.phoneLast4` | string | No | regex `^[0-9]{4}$` | Últimos 4 dígitos. |
| `simObservation.carrierName` | string | No | max 80 | Operador. |
| `simObservation.simType` | string | No | max 40 | Tipo de SIM. |
| `simObservation.simCount` | number (coerce, int) | No | 0..10 | Cantidad de SIMs detectadas. |
| `ipReputation` | object | No | `strict` | Reputación de IP. |
| `ipReputation.isVpn` / `isProxy` / `isTor` | boolean | No | — | Flags de reputación. |
| `ipReputation.countryCode` | string | No | length 2 | País. |
| `ipReputation.city` | string | No | max 120 | Ciudad. |
| `ipReputation.reputationScore` | number (coerce) | No | 0..1 | Score de reputación. |

Todos los objetos anidados usan `.strict()` en Zod: **campos adicionales no declarados provocan error de validación 400**.

**Response 201**
`StartSessionResponseDto`:
| Campo | Tipo | Descripción |
|---|---|---|
| `customerId` | string | Cliente dueño. |
| `sessionId` | string | ID de la sesión creada. |
| `deviceId` | string | ID del dispositivo (creado o reutilizado). |
| `sessionStatus` | string | Normalmente `"active"`. |
| `gpsObservationId` | string \| null | ID de la observación GPS creada, si aplica. |
| `gpsObservationCreated` | boolean | Si se guardó GPS. |
| `gpsObservationSkippedReason` | string \| null | Motivo por el que no se guardó GPS (p.ej. sin permiso). |
| `deviceTrustLevel` | string \| null | Nivel de confianza del vínculo cliente-dispositivo (`"new"` si es el primer vínculo). |
| `nextStep` | string | `"continue_onboarding"` si `customer.lifecycleStatus === 'registered'`, si no `"continue"`. |

**Errores**
- Falta `x-idempotency-key` → `BadRequestException` 400 (se valida dos veces: en el controller y de nuevo en el servicio).
- Cliente no es dueño del recurso → `ForbiddenException` 403.
- Cliente no encontrado → `NotFoundException` 404 ("Cliente no encontrado.").
- `customer.lifecycleStatus === 'blocked'` → `UnprocessableEntityException` 422 (`"CUSTOMER_BLOCKED"`).
- Body inválido (zod) → 400.

---

### POST /api/v1/customers/:customerId/sessions/:sessionId/heartbeat

**Propósito:** Latido periódico de una sesión activa: actualiza señales de dispositivo/GPS/SIM/IP y detecta cambios de riesgo durante la sesión.
**Auth:** Igual que `start` (mismos roles, `assertOwnCustomerResource`).
**Headers:** `x-tenant-id` (requerido), `x-idempotency-key` (requerido).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| `customerId` | string (`^[1-9][0-9]*$`) | Cliente. |
| `sessionId` | string (`^[1-9][0-9]*$`) | Sesión a la que pertenece el heartbeat. |

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| `deviceId` | string | Sí | `^[1-9][0-9]*$` | Debe coincidir con el dispositivo vinculado a la sesión. |
| `clientHeartbeatId` | string | Sí | trim, min 1, max 120 | Identificador idempotente del heartbeat generado por el cliente. |
| `capturedAt` | string (datetime) | No | — | Momento de captura; default = ahora. |
| `gpsObservation` | object | No | igual forma que en `start` | Observación GPS. |
| `permissionChanges` | array | No | max 30, default `[]` | Igual forma que `permissions` en `start`. |
| `locationPermissionGranted` | boolean | No | — | Atajo de permiso de ubicación. |
| `deviceSnapshot` | object | No | igual forma que `device.snapshot` en `start` | Snapshot actualizado del dispositivo. |
| `simObservation` | object | No | igual forma que en `start` | — |
| `ipReputation` | object | No | igual forma que en `start` | — |

**Response 202**
`HeartbeatResponseDto`:
| Campo | Tipo | Descripción |
|---|---|---|
| `sessionId` | string | Eco del path param. |
| `status` | `"accepted"` | Literal fijo. |
| `gpsObservationCreated` | boolean | Si se creó observación GPS en este heartbeat. |
| `gpsObservationId` | string \| null | ID de la observación GPS, si aplica. |
| `gpsObservationSkippedReason` | string \| null | Motivo si no se guardó GPS. |
| `riskSignalsCreated` | number | Cantidad de eventos de riesgo de dispositivo creados (root/emulador/VPN detectados en `deviceSnapshot`). |

**Errores**
- Falta `x-idempotency-key` → 400.
- Cliente no dueño → 403.
- Cliente no encontrado → `NotFoundException` 404.
- Sesión no encontrada (para ese tenant/customer/sessionId) → `NotFoundException` 404 ("Sesión no encontrada.").
- `session.sessionStatus !== 'active'` → `UnprocessableEntityException` 422 (`"SESSION_NOT_ACTIVE"`).
- `deviceId` del body no coincide con el dispositivo de la sesión → `ForbiddenException` 403 ("El dispositivo no corresponde a la sesión.").
- Dispositivo (`deviceId`) no encontrado → `NotFoundException` 404 ("Dispositivo no encontrado.").
- Dispositivo no vinculado al cliente y `currentUser.role === 'customer'` → `ForbiddenException` 403 ("El dispositivo no está vinculado al cliente.").

---

### POST /api/v1/customers/:customerId/sessions/:sessionId/end

**Propósito:** Finalizar explícitamente una sesión activa (logout, timeout del cliente, etc.).
**Auth:** Igual que los anteriores.
**Headers:** `x-tenant-id` (requerido), `x-idempotency-key` (requerido).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| `customerId` | string | Cliente. |
| `sessionId` | string | Sesión a finalizar. |

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| `deviceId` | string | No | `^[1-9][0-9]*$` | Si se envía, debe coincidir con el dispositivo de la sesión. |
| `endedAt` | string (datetime) | No | — | Momento de fin; default = ahora. |
| `reasonCode` | string | No | trim, min 1, max 80, default `"customer_logout"` | Motivo de cierre. |

**Response 200**
`EndSessionResponseDto`:
| Campo | Tipo | Descripción |
|---|---|---|
| `sessionId` | string | ID de la sesión finalizada. |
| `sessionStatus` | string | Normalmente `"ended"`. |
| `endedAt` | string (ISO) | Momento efectivo de cierre. |

**Errores**
- Falta `x-idempotency-key` → 400.
- Cliente no dueño → 403.
- Sesión no encontrada → `NotFoundException` 404.
- Sesión no está `active` → `UnprocessableEntityException` 422 (`"SESSION_NOT_ACTIVE"`).
- `deviceId` del body no coincide con el de la sesión → `ForbiddenException` 403.

---

### GET /api/v1/customers/:customerId/session-state

**Propósito:** Consultar el estado actual (sesión activa, dispositivo vinculado, última ubicación) de un cliente — útil para pantallas de estado/monitoreo del propio cliente o soporte.
**Auth:** Igual grupo de roles que los anteriores; `assertOwnCustomerResource`.
**Headers:** `x-tenant-id` (requerido).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| `customerId` | string | Cliente consultado. |

**Request body**
Sin body.

**Response 200**
Si no hay sesión activa:
| Campo | Tipo | Descripción |
|---|---|---|
| `customerId` | string | — |
| `activeSession` | `null` | — |
| `device` | `null` | — |
| `location` | `{ lastGpsObservedAt: null, hasRecentGps: false }` | — |

Si hay sesión activa:
| Campo | Tipo | Descripción |
|---|---|---|
| `customerId` | string | — |
| `activeSession.sessionId` | string | — |
| `activeSession.status` | string | Estado de la sesión (`"active"` por defecto). |
| `activeSession.startedAt` | string (ISO) \| null | — |
| `device.deviceId` | string | (Solo si la sesión tiene `deviceId`, si no `device` es `null`.) |
| `device.trustLevel` | string \| null | Nivel de confianza del vínculo cliente-dispositivo. |
| `device.riskStatus` | string \| null | Estado de riesgo del dispositivo. |
| `device.latestSnapshot` | object \| null | Último snapshot de dispositivo de la sesión. |
| `device.latestSnapshot.capturedAt` | string (ISO) \| null | — |
| `device.latestSnapshot.appVersion` | string \| null | — |
| `device.latestSnapshot.vpnDetected` | boolean \| null | — |
| `device.latestSnapshot.isRooted` | boolean \| null | — |
| `device.latestSnapshot.isEmulator` | boolean \| null | — |
| `location.lastGpsObservedAt` | string (ISO) \| null | Última observación GPS de la sesión. |
| `location.hasRecentGps` | boolean | `true` si la última observación GPS es de ≤ 30 minutos. |

**Errores**
- Cliente no dueño → `ForbiddenException` 403.
- Cliente no encontrado → `NotFoundException` 404.

---

### GET /api/v1/operations/sessions/:sessionId/investigation-summary

**Propósito:** Vista consolidada de una sesión para analistas de operaciones/riesgo/fraude/cumplimiento — reúne GPS, snapshots, permisos, auth events, SIM, IP, eventos de riesgo, acciones, observaciones y auditoría de la sesión.
**Auth:** `@Roles('internal_operator','risk_analyst','compliance_analyst','fraud_analyst','admin','platform_admin','system')` a nivel de clase (`OperationsSessionsController`). Adicionalmente `assertInternalAccess(currentUser)` exige `isInternalOrSystemRole` (rechaza rol `customer`).
**Headers:** `x-tenant-id` (requerido).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| `sessionId` | string (`^[1-9][0-9]*$`) | Sesión a investigar (sin scope de `customerId` en el path). |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| `session.sessionId` | string | — |
| `session.customerId` | string \| null | — |
| `session.deviceId` | string \| null | — |
| `session.status` | string \| null | — |
| `session.channel` | string \| null | — |
| `session.authMethod` | string \| null | — |
| `session.startedAt` | string (ISO) \| null | — |
| `session.endedAt` | string (ISO) \| null | — |
| `session.ipAddress` | string \| null | — |
| `session.userAgent` | string \| null | — |
| `customer` | object \| null | `{ customerId, customerCode, lifecycleStatus }` si la sesión tiene `customerId`. |
| `device` | object \| null | `{ deviceId, riskStatus, firstSeenAt, lastSeenAt }` si la sesión tiene `deviceId`. |
| `gpsObservations[]` | array | `{ id, capturedAt, accuracyMeters, hasCoordinates }`. |
| `deviceSnapshots[]` | array | `{ id, capturedAt, appVersion, vpnDetected, isRooted, isEmulator }`. |
| `permissions[]` | array | `{ id, permissionCode, granted, respondedAt }`. |
| `authEvents[]` | array | `{ id, eventType, loginSuccessful, occurredAt }`. |
| `ipReputation[]` | array | `{ id, isVpn, isProxy, isTor, countryCode, city, reputationScore, capturedAt }`. |
| `simObservations[]` | array | `{ id, carrierName, simType, simCount, phoneLast4, capturedAt }`. |
| `deviceRiskEvents[]` | array | `{ id, eventType, reasonCode, happenedAt }`. |
| `customerActions[]` | array | `{ id, eventName, screenName, occurredAt }`. |
| `customerObservations[]` | array | `{ id, observationCode, valueBoolean, capturedAt }`. |
| `auditTrail[]` | array | `{ id, actionCode, actorType, occurredAt }`. |

**Errores**
- Rol `customer` (o cualquier rol no interno/sistema) → `ForbiddenException` 403 ("Este endpoint es interno.").
- Sesión no encontrada → `NotFoundException` 404 ("Sesión no encontrada.").

---

## Módulo: Risk (`src/modules/risk/risk.controller.ts`)

`@Controller()` sin prefijo propio → rutas bajo `/api/v1` directamente.

### POST /api/v1/customers/:customerId/risk-assessments

**Propósito:** Ejecutar (síncronamente) una evaluación de riesgo para un cliente — calcula scores de identidad/contacto/dispositivo/comportamiento/fraude a partir de datos ya registrados (consentimientos, contactos, identidades) y decide si continúa el flujo o pasa a revisión manual.
**Auth:** `@Roles('customer','internal_operator','risk_analyst','system','admin','platform_admin')`. `assertOwnCustomerResource` aplica para rol `customer`.
**Headers:** `x-tenant-id` (requerido), `x-idempotency-key` (requerido — 400 si falta; se valida en controller y de nuevo en servicio, aunque el valor de idempotencia **no se usa aún para deduplicar la ejecución** en este servicio, solo se persiste como `idempotencyKey` de la corrida).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| `customerId` | string (`^[1-9][0-9]*$`) | Cliente evaluado. |

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| `assessmentType` | enum | Sí | `onboarding_initial`\|`behavior_update`\|`manual_recheck`\|`fraud_recheck` | Tipo de evaluación. |
| `channel` | enum | Sí | `mobile_app`\|`operations_panel`\|`system` | Canal que dispara la evaluación. |
| `sessionId` | string | No | `^[1-9][0-9]*$` | Sesión asociada. |
| `deviceId` | string | No | `^[1-9][0-9]*$` | Dispositivo asociado. |
| `requestedLimitContext` | object | No | — | Contexto del límite solicitado. |
| `requestedLimitContext.purpose` | string | Sí (si se envía el objeto) | trim, min 1, max 120 | Propósito de la solicitud (p.ej. tipo de límite/crédito). |

**Response 201**
| Campo | Tipo | Descripción |
|---|---|---|
| `riskAssessmentRunId` | string | ID de la corrida creada. |
| `riskAssessmentResultId` | string | ID del resultado creado. |
| `decision` | string | `"approved_for_next_step"` o `"manual_review_required"`. |
| `riskLevel` | string | `"low"`\|`"medium"`\|`"high"` (según `scoreTotal`: ≥75 low, ≥55 medium, si no high). |
| `fraudRiskLevel` | string | `"low"`\|`"medium"`\|`"high"` derivado de `fraudScore` (≥70 high, ≥40 medium, si no low). |
| `manualReviewCaseId` | string \| null | ID del caso de revisión manual creado, si `decision === 'manual_review_required'`. |
| `nextStep` | string | `"manual_review"` o `"continue_onboarding"`. |
| `reasons[]` | array | `{ code: string, message: string }` — un ítem por cada razón (`missing_identity_document`, `missing_verified_contact` o `minimum_onboarding_risk_passed`). |

**Errores**
- Falta `x-idempotency-key` → `BadRequestException` 400.
- Cliente no dueño (rol `customer`) → `ForbiddenException` 403.
- Cliente no encontrado → `NotFoundException` 404 ("Cliente no encontrado.").
- `customer.lifecycleStatus === 'blocked'` → `UnprocessableEntityException` 422 (`"CUSTOMER_BLOCKED_FOR_RISK_ASSESSMENT"`).
- Sin ningún consentimiento vigente (`granted && !revokedAt`) → `UnprocessableEntityException` 422 (`"REQUIRED_CONSENT_MISSING"`).

---

### GET /api/v1/operations/risk-assessments/:riskAssessmentRunId

**Propósito:** Ver el detalle completo de una corrida de evaluación de riesgo (para analistas de operaciones/riesgo/cumplimiento/fraude).
**Auth:** `@Roles('internal_operator','risk_analyst','compliance_analyst','fraud_analyst','admin','platform_admin')`.
**Headers:** `x-tenant-id` (requerido).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| `riskAssessmentRunId` | string (`^[1-9][0-9]*$`) | Corrida a consultar. |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| `run` | modelo `RiskAssessmentRun` (Sequelize, forma cruda) | La corrida en sí. |
| `result` | modelo `RiskAssessmentResult` \| null | Resultado asociado. |
| `rulesFired` | array de modelo `RuleFired` | Reglas disparadas durante la corrida. |
| `featureContributions` | array de modelo `Contribution` | Contribuciones de features al score. |
| `featureSnapshot` | modelo `FeatureSnapshot` \| null | Snapshot de features usado. |

Nota: estos objetos son instancias/atributos crudos de Sequelize (no pasan por un mapper dedicado), por lo que incluyen todas las columnas de cada tabla tal cual están en la base (incluyendo `tenantId`, timestamps, etc.). El frontend debe tratarlos como "forma de tabla" más que como DTO estable.

**Errores**
- Corrida no encontrada → `NotFoundException` 404 ("Evaluación de riesgo no encontrada.").

---

### GET /api/v1/operations/risk-assessments/:riskAssessmentRunId/explanation

**Propósito:** Obtener una explicación legible de la decisión de una corrida de riesgo (factores positivos/negativos, reglas disparadas), para mostrar a analistas el "por qué" de la decisión.
**Auth:** Igual que el endpoint de detalle.
**Headers:** `x-tenant-id` (requerido).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| `riskAssessmentRunId` | string | Corrida a explicar. |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| `decision` | string \| null | `result.recommendedAction`. |
| `summary` | string | Texto generado: `"Decisión basada en: <reglas>."` o texto fijo si no hay reglas. |
| `topPositiveFactors[]` | array | `{ code, label, impact: 'positive' }` — contribuciones con `scorePoints >= 60`. |
| `topNegativeFactors[]` | array | `{ code, label, impact: 'negative' }` — contribuciones con `scorePoints < 60`. |
| `rulesFired[]` | array de string | Códigos de razón (`reasonCode`) de las reglas disparadas. |
| `recommendedAction` | string \| null | Igual a `decision`. |

**Errores**
- Corrida no encontrada → `NotFoundException` 404 (propagado desde el detalle).
- Corrida sin `result` asociado → `NotFoundException` 404 ("Resultado de riesgo no encontrado.").

---

## Módulo: External Data (`src/modules/external-data/external-data.controller.ts`)

Este archivo define **8 controllers** distintos. Todos comparten helpers del archivo: `tenantIdFromHeader` (header `x-tenant-id`, con fallback a `currentUser.tenantId`), `actorId` (usa `internalUserId ?? platformUserId ?? customerId` del usuario autenticado como actor de auditoría), `assertCustomerAccess` (envuelve `assertOwnCustomerResource` solo si se provee `customerId`), y `customerScopeForConsentMutation` (para revocar consentimiento: si el rol es `customer`, exige que el JWT traiga `customerId`, si no `ForbiddenException`).

### Sub-módulo: `ExternalDataController` (`@Controller('external-data')`)

Roles de clase: `customer, internal_operator, risk_analyst, compliance_analyst, fraud_analyst, admin, platform_admin, system`.

#### POST /api/v1/external-data/consents

**Propósito:** Registrar el consentimiento de un cliente para que un proveedor externo (o de forma general) consulte/verifique sus datos.
**Auth:** Guards + roles de clase. `assertCustomerAccess(currentUser, body.customerId)`.
**Headers:** `x-tenant-id` (con fallback a `currentUser.tenantId`), `x-forwarded-for` (opcional, se guarda como IP), `user-agent` (opcional).

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| `customerId` | string | Sí | `^\d+$` | Cliente que otorga el consentimiento. |
| `providerCode` | string | No | min 2, max 80; se normaliza a mayúsculas, `CGIP`→`SEGIP` | Proveedor específico; si se omite, `purposeCode` = `purpose` general y `providerCode` de respuesta = `"GENERAL"`. |
| `purpose` | string | Sí | trim, min 3, max 100 | Propósito del consentimiento. |
| `legalTextVersion` | string | No | trim, min 1, max 80, default `"v1"` | Versión del texto legal aceptado. |
| `accepted` | boolean | No | default `true` | Si fue aceptado (la respuesta siempre marca `accepted: true` independientemente de este valor — ver nota). |
| `channel` | string | No | trim, min 2, max 40, default `"api"` | Canal del consentimiento. |
| `sessionId` | string | No | `^\d+$` | Sesión asociada. |
| `deviceFingerprintSnapshot` | string | No | trim, max 180 | Huella del dispositivo al momento del consentimiento. |

**Response 201**
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | string | ID del registro de consentimiento creado. |
| `customerId` | string | Eco del body. |
| `providerCode` | string | Normalizado o `"GENERAL"`. |
| `purposeCode` | string | `purpose` tal cual, o `<providerCode_lower>_<purpose_lower>` si hay `providerCode`. |
| `accepted` | `true` | Literal fijo (no refleja `body.accepted`). |
| `grantedAt` | Date/string | Timestamp de otorgamiento devuelto por el repositorio (tipo `Date` de Sequelize, se serializa a ISO por Nest). |

**Errores**
- `assertCustomerAccess` → `ForbiddenException` 403 si el cliente intenta consentir por otro `customerId`.
- Body inválido → 400.

---

#### GET /api/v1/external-data/consents/user/:customerId

**Propósito:** Listar todos los consentimientos externos de un cliente.
**Auth:** Igual que arriba. `assertCustomerAccess(currentUser, params.customerId)`.
**Headers:** `x-tenant-id`.

**Path params**: `customerId` (string, `^\d+$`).
**Request body**: Sin body.

**Response 200**
Array de:
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | string | — |
| `customerId` | string | — |
| `purposeCode` | string/null | — |
| `granted` | boolean/null | — |
| `grantedAt` | Date/null | — |
| `revokedAt` | Date/null | — |
| `channel` | string/null | — |

**Errores**: acceso cruzado de cliente → 403.

---

#### POST /api/v1/external-data/consents/:consentId/revoke

**Propósito:** Revocar un consentimiento externo previamente otorgado (bloquea futuras consultas que lo requieran; no invalida resultados ya obtenidos).
**Auth:** Igual grupo de roles. Si `currentUser.role === 'customer'`, exige `currentUser.customerId` en el JWT (si no, `ForbiddenException`) y luego valida que el consentimiento pertenezca a ese cliente.
**Headers:** `x-tenant-id`.

**Path params**: `consentId` (string, `^\d+$`).
**Request body**: Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | string | — |
| `customerId` | string | — |
| `revoked` | `true` | Literal. |
| `revokedAt` | Date | Timestamp de revocación. |

**Errores**
- Rol `customer` sin `customerId` en el JWT → `ForbiddenException` 403 ("El token de cliente no contiene customerId.").
- Consentimiento no encontrado → `NotFoundException` 404 ("Consentimiento no encontrado.").
- Consentimiento de otro cliente (cuando `customerId` fue derivado del JWT del cliente) → `ForbiddenException` 403 ("El consentimiento no corresponde al cliente autenticado.").

---

#### POST /api/v1/external-data/requests/preview

**Propósito:** Simular ("dry-run") una solicitud a un proveedor externo sin ejecutarla ni generar costo — permite al frontend mostrar de antemano si la solicitud requeriría consentimiento, aprobación manual, si sería servida desde caché, y su costo estimado.
**Auth:** Igual grupo de roles. `assertCustomerAccess(currentUser, body.customerId)`.
**Headers:** `x-tenant-id`.

**Request body** (`externalDataRequestSchema`, compartido con `POST /requests`):
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| `customerId` | string | No | `^\d+$` | Cliente objetivo. |
| `providerCode` | string | Sí | min 2, max 80, mayúsculas, `CGIP`→`SEGIP` | Proveedor. |
| `queryType` | string | Sí | trim, min 3, max 80, se sube a mayúsculas | Tipo de consulta (p.ej. `IDENTITY_VERIFICATION`). |
| `purpose` | string | Sí | trim, min 3, max 100 | Propósito de negocio. |
| `decisionStage` | string | Sí | trim, min 3, max 60, mayúsculas | Etapa de decisión (p.ej. `ONBOARDING`). |
| `input` | object | No | `Record<string, unknown>`, default `{}` | Payload específico del proveedor. |
| `scenario` | string | No | trim, max 80 | Escenario de mock/sandbox. |
| `approvedByAdminId` | string | No | `^\d+$` | Admin que pre-aprueba (necesario para saltar aprobación manual en providers de alto costo). |
| `forceRefresh` | boolean | No | — | Si `true`, ignora caché (TTL efectivo = 0). |

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| `providerCode` | string | — |
| `queryType` | string | — |
| `purpose` | string | — |
| `decisionStage` | string | — |
| `modeUsed` | string | `mock_local`\|`mock_server`\|`sandbox`\|`production`\|`disabled`. |
| `wouldExecute` | boolean | Si la ejecución real procedería. |
| `status` | string | `PROVIDER_UNAVAILABLE`, `CONSENT_REQUIRED`, estado de bloqueo de política, o `PENDING`. |
| `reasonCode` | string | Motivo del estado. |
| `consent.status` | string | `NOT_REQUIRED`\|`VALID`\|`CONSENT_REQUIRED`. |
| `consent.consentId` | string (opcional) | ID del consentimiento válido encontrado. |
| `consent.purposeCodes[]` | array de string | Propósitos aceptados evaluados. |
| `costPolicy` | object \| null | Política de costo aplicable (ver forma abajo). |
| `estimatedCostAmount` | string \| null | Costo estimado. |
| `currency` | string \| null | Moneda. |
| `requestPayloadHash` | string | Hash del payload de entrada (para trazabilidad/idempotencia). |
| `cache.cacheTtlSeconds` | number | TTL efectivo aplicado. |
| `cache.cacheEligible` | boolean | Si el request es elegible para caché. |
| `cache.cacheHit` | boolean | Si actualmente hay una respuesta cacheada utilizable. |
| `cache.cachedRequestId` | string \| null | ID del request cacheado, si existe. |
| `cache.forceRefresh` | boolean | Eco de `body.forceRefresh`. |
| `safeInputPreview` | unknown | Copia redactada de `body.input`. |
| `note` | string | Texto fijo aclaratorio (es una simulación). |

Forma de `costPolicy` (también usada en endpoints de administración): `{ id, providerId, queryType, unitCostAmount, currency, costTier, maxQueriesPerUserPerDay, maxQueriesPerUserPerMonth, maxQueriesGlobalPerDay, allowedDecisionStagesJson: string[], requiresManualApproval, requiresAdminRole, blockByDefault, cacheTtlSeconds, featureTtlSeconds, retryMaxAttempts, retryBackoffSeconds, active, activeFrom, activeTo }`.

**Errores**
- Proveedor no configurado/inactivo → `NotFoundException` 404 ("Provider externo no configurado: `<code>`.").
- No escribe nada en base de datos (no consume caché, cuota ni genera costo real).

---

#### POST /api/v1/external-data/requests

**Propósito:** Ejecutar realmente una consulta a un proveedor externo (KYC, buró, pagos, telco, redes sociales, etc.) con control de costo, consentimiento, cuota, circuit breaker y caché.
**Auth:** Igual grupo de roles. `assertCustomerAccess(currentUser, body.customerId)`.
**Headers:** `x-tenant-id`, `x-idempotency-key` (opcional a nivel de tipo, pero fuertemente recomendado: si se reutiliza con distinto scope, 400; si coincide exactamente, se reproduce el resultado anterior sin nueva ejecución/costo).

**Request body**: mismo `externalDataRequestSchema` que `preview` (ver arriba).

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| `requestId` | string \| null | ID del registro de solicitud persistido. |
| `providerCode` | string | — |
| `status` | string | `PENDING`\|`BLOCKED_BY_COST_POLICY`\|`CONSENT_REQUIRED`\|`MANUAL_APPROVAL_REQUIRED`\|`RUNNING`\|`COMPLETED`\|`FAILED`\|`PROVIDER_UNAVAILABLE`\|`PROVIDER_AUTH_FAILED`\|`RATE_LIMITED`\|`MOCKED`\|`DATA_NOT_AVAILABLE`\|`CACHED`. |
| `reasonCode` | string (opcional) | Motivo del estado (p.ej. `CACHE_HIT`, `<CODE>_PROVIDER_DISABLED`, `PRODUCTION_GATE_BLOCKED:<blockers>`). |
| `observations[]` | array | `{ observationKey, valueType: 'BOOLEAN'|'NUMBER'|'STRING'|'DATE'|'JSON', valueBoolean?, valueNumber?, valueString?, valueDate?, valueJson?, confidenceScore?, verified?, manualReviewRequired?, featureNamespace, featureKey }`. |
| `features` | object | Mapa aplanado `featureKey -> valor` (según `valueType`) más `${featureKey}__confidence` por cada observación. |
| `manualReviewRequired` | boolean | — |
| `modeUsed` | string | `mock_local`\|`mock_server`\|`sandbox`\|`production`\|`disabled`. |

**Errores**
- Proveedor no configurado → `NotFoundException` 404.
- Adapter no implementado → `NotFoundException` 404 ("Adapter externo no implementado: `<code>`.").
- Reuso de `x-idempotency-key` con distinto scope → `BadRequestException` 400 `{ code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST', message, providerCode, existingRequestId, mismatches }`.
- **No** lanza excepción si falta consentimiento, el proveedor está deshabilitado, hay error del proveedor, o se excede cuota/política: en todos esos casos responde **200** con `status` reflejando el bloqueo (`CONSENT_REQUIRED`, `PROVIDER_UNAVAILABLE`, `BLOCKED_BY_COST_POLICY`, `MANUAL_APPROVAL_REQUIRED`, `FAILED`, etc.) — el frontend debe inspeccionar `status`/`reasonCode`, no asumir éxito por el código HTTP.
- `forceRefresh: true` deshabilita completamente el uso de caché para esta llamada.

---

#### GET /api/v1/external-data/requests/:requestId

**Propósito:** Ver el detalle completo (auditoría) de una solicitud a proveedor externo ya ejecutada.
**Auth:** Igual grupo de roles (sin restricción adicional de `customerId` en el controller).
**Headers:** `x-tenant-id`.

**Path params**: `requestId` (string, `^\d+$`).

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | string | — |
| `providerId` | string \| null | — |
| `customerId` | string \| null | — |
| `requestType` | string | — |
| `purposeCode` | string | — |
| `decisionStage` | string | — |
| `modeUsed` | string | — |
| `responseStatus` | string | — |
| `responseCode` | string | — |
| `approvalStatus` | string | — |
| `estimatedCostAmount` | string \| null | — |
| `actualCostAmount` | string \| null | — |
| `currency` | string \| null | — |
| `requestedAt` | string (ISO) | — |
| `respondedAt` | string (ISO) \| null | — |
| `latencyMs` | number \| null | — |
| `errorMessageSafe` | string \| null | — |
| `metadataJson` | object | — |
| `responses[]` | array | `{ id, providerStatusCode, providerReference, responseHash, redactedPayloadJson, normalizedPayloadJson, createdAt }` — payload completo sin filtrar, expuesto a roles autorizados. |

**Errores**
- Solicitud no encontrada para el tenant → `NotFoundException` 404 ("Solicitud de provider externo no encontrada.").

---

#### GET /api/v1/external-data/providers/health

**Propósito:** Ver el estado de salud de uno o todos los proveedores externos configurados.
**Auth:** Igual grupo de roles.
**Headers:** ninguno especial (no usa `x-tenant-id`, es información global de plataforma).

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| `providerCode` | string | No | — | Si se omite, se listan todos los proveedores (incluyendo inactivos). |

**Response 200**
Array de `{ ...campos de salud del adapter (providerCode, status: 'UP'|'DOWN'|'DEGRADED'|'UNKNOWN', mode, latencyMs, checkedAt, errorCode?), providerCode }`.

**Errores**
- `providerCode` inválido/inactivo (cuando se especifica) → `NotFoundException` 404.
- Proveedor sin adapter registrado → `NotFoundException` 404 ("Adapter externo no implementado: `<code>`.").

---

#### GET /api/v1/external-data/users/:customerId/features

**Propósito:** Listar los snapshots de features derivados de datos externos para un cliente.
**Auth:** Igual grupo. `assertCustomerAccess`.
**Headers:** `x-tenant-id`.

**Path params**: `customerId` (string, `^\d+$`).

**Response 200**
Array (máx. 20, más recientes primero) de:
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | string | — |
| `customerId` | string \| null | — |
| `snapshotReason` | string | — |
| `triggeringEntityId` | string \| null | — |
| `featureSetVersion` | string | — |
| `featuresJson` | object | — |
| `missingFeaturesJson` | object | — |
| `integrityHash` | string | — |
| `createdAt` | string (ISO) | — |

**Errores**: acceso cruzado → 403.

---

#### GET /api/v1/external-data/users/:customerId/scoring-input

**Propósito:** Obtener el conjunto de features consolidado (únicamente desde snapshots de riesgo, nunca llamando proveedores en vivo) que un motor de scoring debería usar para un cliente.
**Auth:** Igual grupo. `assertCustomerAccess`.
**Headers:** `x-tenant-id`.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| `customerId` | string | — |
| `generatedAt` | string (ISO) | — |
| `featureSource` | `"risk_feature_snapshots_only"` | Literal fijo. |
| `maxAgeHours` | number | Umbral de frescura (env `EXTERNAL_FEATURE_MAX_AGE_HOURS`, default 168). |
| `features` | object | Mapa fusionado de hasta 50 snapshots recientes (los más nuevos sobrescriben claves en conflicto). |
| `missing` | object | Features declaradas como faltantes en los snapshots. |
| `freshness[]` | array | `{ snapshotId, snapshotReason, ageHours, stale: boolean }`. |
| `qualityFlags.hasExternalFeatures` | boolean | — |
| `qualityFlags.hasStaleFeatures` | boolean | — |
| `qualityFlags.rawProviderAccessBlocked` | `true` | Literal fijo. |
| `qualityFlags.scoringMayCallProvidersDirectly` | `false` | Literal fijo. |

Nota importante: los features "stale" (más viejos que `maxAgeHours`) **no se excluyen** de `features`/`missing` — el frontend/consumidor debe filtrar usando `freshness[].stale` o `qualityFlags.hasStaleFeatures`.

**Errores**: acceso cruzado → 403.

---

#### GET /api/v1/external-data/users/:customerId/decision-package

**Propósito:** Paquete consolidado para decisión (scoring input + observaciones + consentimientos + últimas solicitudes a proveedores + flags de riesgo) — pensado como snapshot único a mostrar/auditar en una decisión de negocio.
**Auth:** Igual grupo. `assertCustomerAccess`.
**Headers:** `x-tenant-id`.

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| `includeRawResponses` | boolean (coerce) | No | `false` | Si `true`, incluye el payload crudo (`redactedPayloadJson`/`normalizedPayloadJson`) de cada respuesta en `latestRequests[].responses`; si `false`, ese array viene vacío. |
| `featureMaxAgeHours` | number (coerce, int) | No | — (usa el default interno de `getCustomerScoringInput` si se omite) | 1..8760. |

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| `customerId` | string | — |
| `generatedAt` | string (ISO) | — |
| `packageVersion` | `"external-data-decision-package-v5"` | Literal fijo. |
| `scoringInput` | objeto (misma forma que `GET .../scoring-input`) | — |
| `observations[]` | igual forma que `GET .../observations` (límite 100) | — |
| `consents[]` | igual forma que `GET .../consents/user/:customerId` | — |
| `latestRequests[]` | array (hasta 20 de las últimas 100 solicitudes en 365 días) | `{ requestId, providerId, requestType, decisionStage, modeUsed, responseStatus, responseCode, requestedAt, respondedAt, cost: actualCostAmount ?? estimatedCostAmount ?? null, currency, responses: [] o array con detalle crudo }`. |
| `riskFlags.missingCoreFeatures[]` | array de string | Contra lista fija de 8 features "core" (`identity_document_exists`, `identity_name_match_score`, `identity_verification_status`, `identity_confidence_level`, `phone_trust_score`, `phone_fraud_risk_score`, `whatsapp_contactability_score`, `digital_trust_score`). |
| `riskFlags.hasMissingCoreFeatures` | boolean | — |
| `riskFlags.staleFeatureSnapshots[]` | array | — |
| `riskFlags.hasStaleFeatureSnapshots` | boolean | — |
| `riskFlags.blockedRequestsCount` | number | — |
| `riskFlags.failedRequestsCount` | number | — |
| `guidance[]` | array de 3 strings fijos | Recomendaciones de uso. |

**Errores**: acceso cruzado → 403.

---

#### GET /api/v1/external-data/users/:customerId/observations

**Propósito:** Listar observaciones normalizadas derivadas de proveedores externos para un cliente.
**Auth:** Igual grupo. `assertCustomerAccess`.
**Headers:** `x-tenant-id`.

**Response 200**
Array (default límite 50) de:
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | string | — |
| `customerId` | string \| null | — |
| `observationCode` | string | — |
| `valueText` | string \| null | — |
| `valueNumber` | number \| null | — |
| `valueBoolean` | boolean \| null | — |
| `valueJson` | object \| null | — |
| `sourceProviderId` | string \| null | — |
| `confidenceScore` | number \| null | — |
| `verificationStatus` | string \| null | — |
| `capturedAt` | string (ISO) | — |
| `derivationMethod` | string \| null | — |

**Errores**: acceso cruzado → 403.

---

### Sub-módulo: `AdminExternalProvidersController` (`@Controller('admin/external-providers')`)

Roles de clase: `admin, platform_admin, risk_analyst, compliance_analyst`. Endpoints de administración/observabilidad de proveedores — no manejan `customerId` propio del cliente autenticado (son de uso interno), salvo `test`/`approve`/`retry` que operan en nombre de un cliente indicado en el body/registro existente.

#### GET /api/v1/admin/external-providers

**Propósito:** Listar todos los proveedores externos configurados en el sistema.
**Headers:** ninguno especial.
**Response 200**: array de `{ id, code, name, category, status, defaultMode, requiresConsent, requiresManualApproval, isCostly, description }`.
**Errores**: ninguno explícito.

#### GET /api/v1/admin/external-providers/health

Igual a `GET /external-data/providers/health` sin filtro (`providerCode` no soportado aquí, siempre todos).

#### GET /api/v1/admin/external-providers/readiness

**Propósito:** Evaluar si cada proveedor está listo para mock/producción.
**Response 200**: `{ generatedAt, readiness: [{ providerCode, name, category, status, mode, health, policies: costPolicy[], recentFailures: number, readyForMock: boolean, readyForProduction: boolean, blockers: string[] }] }`.

#### GET /api/v1/admin/external-providers/quality-audit

**Propósito:** Auditoría de calidad/gobernanza de la configuración de proveedores.
**Response 200**: `{ generatedAt, score: number, rating: 'A'|'B'|'C'|'D', findings: [{ severity: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL', providerCode?, code, message }], qualityGates: { canEnableProductionProviders, canRunCostlyProvidersAutomatically: false, scoringProviderCouplingAllowed: false } }`.

#### GET /api/v1/admin/external-providers/production-gate

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| `providerCode` | string | No | — | Filtra a un proveedor. |
| `strict` | boolean (coerce) | No | `true` | Si `true`, también bloquea por hallazgos de severidad HIGH (no solo CRITICAL). |

**Response 200**: `{ generatedAt, providerCode: string ('ALL' o código), strict, status: 'PASS'|'FAIL', canPromoteProduction: boolean, blockers: string[], qualityScore, sanitizationScore, providers: [{ providerCode, mode, healthStatus, readyForMock, readyForProduction, blockers }], requiredManualChecks: string[] (5 fijos) }`.

#### GET /api/v1/admin/external-providers/sla

**Query params**: `providerCode` (opcional), `days` (int 1..366, default 30).
**Headers:** `x-tenant-id` (con fallback a `currentUser.tenantId`).
**Response 200**: `{ generatedAt, providerCode, days, providers: [{ providerCode, total, success, failed, blocked, cached, rateLimited, authFailed, successRate, failureRate, p95LatencyMs, actualCost, warnings: string[] }] }`.
**Errores**: `providerCode` inválido → `NotFoundException` 404.

#### GET /api/v1/admin/external-providers/usage

**Query params**: `providerCode` (opcional), `days` (int 1..366, default 30).
**Headers:** `x-tenant-id`.
**Response 200**: `{ generatedAt, days, providerCode, summary: { total, executed, blocked, cached, estimatedCost, actualCost } }`.
**Errores**: `providerCode` inválido → `NotFoundException` 404.

#### GET /api/v1/admin/external-providers/idempotency-audit

**Query params**: `days` (int 1..366, default 30), `limit` (int 1..10000, default 5000).
**Headers:** `x-tenant-id`.
**Response 200**: `{ generatedAt, days, inspectedRequests, findings: [{ severity: 'HIGH'|'LOW', code: 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_SCOPE'|'IDEMPOTENCY_REPLAY_SAME_SCOPE', keyHash, occurrences, requestIds: string[] }], score, qualityGate: 'PASS'|'FAIL', controls: string[] }`.

#### GET /api/v1/admin/external-providers/retention/preview

**Query params**: `days` (int 1..3650, default 90), `limit` (int 1..500, default 100).
**Response 200**: `{ generatedAt, olderThanDays, candidateCount, candidates: [{ requestId, providerId, customerId, requestedAt, responseStatus, action: 'REVIEW_BEFORE_PURGE_OR_ARCHIVE' }], note }`. No borra nada (es solo preview).

#### GET /api/v1/admin/external-providers/sanitization-audit

**Query params**: `limit` (int 1..500, default 100).
**Response 200**: `{ generatedAt, inspectedResponses, score, findings: [{ severity: 'HIGH', responseId, providerRequestId, code: 'POSSIBLE_UNREDACTED_SECRET_KEY', key }], qualityGate: 'PASS'|'FAIL' }`.

#### POST /api/v1/admin/external-providers/policy/preview

Idéntico contrato (request/response) a `POST /external-data/requests/preview`.

#### PATCH /api/v1/admin/external-providers/:providerCode/runtime

**Propósito:** Cambiar el modo (`mock_local|mock_server|sandbox|production|disabled`) o el estado de un proveedor.
**Path params**: `providerCode` (string, normalizado a mayúsculas).
**Request body**:
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| `defaultMode` | enum | No | `mock_local`\|`mock_server`\|`sandbox`\|`production`\|`disabled` | Nuevo modo. |
| `providerStatus` | enum | No | `ACTIVE`\|`DISABLED`\|`MOCK_ONLY`\|`SANDBOX_ONLY` | Nuevo estado. |
| `isActive` | boolean | No | — | — |
| `confirmProductionReady` | boolean | No | default `false` | Debe ser `true` si `defaultMode === 'production'`. |
| `reason` | string | No | trim, min 3, max 240 | Motivo (se anexa a la descripción del proveedor como registro de auditoría). |

**Response 200**: `{ providerCode, defaultMode, providerStatus, isActive, reason: string|null }`.
**Errores**:
- Proveedor no encontrado → `NotFoundException` 404.
- `defaultMode === 'production'` sin `confirmProductionReady: true` → `BadRequestException` 400 ("PRODUCTION_MODE_REQUIRES_CONFIRMATION_AND_REAL_PROVIDER_CONTRACT").
- Bloqueadores de gate de producción (falta flag de integración real o credenciales) → `BadRequestException` 400 `{ code: 'PRODUCTION_GATE_BLOCKED', message, providerCode, blockers: string[] }`.

#### POST /api/v1/admin/external-providers/:providerCode/kill-switch

**Propósito:** Deshabilitar de inmediato un proveedor (equivalente a `runtime` con `defaultMode: 'disabled', providerStatus: 'DISABLED', isActive: false`).
**Request body**: mismo schema que `runtime` (solo `reason` es relevante; default `"Kill switch activado manualmente."`).
**Response 200**: misma forma que `runtime`.
**Errores**: mismos que `runtime` (en la práctica no debería tocar la rama de bloqueo de producción).

#### GET /api/v1/admin/external-providers/:providerCode/cost-policy

**Response 200**: array de `costPolicy` (forma documentada en `preview`), puede ser `[]`.
**Errores**: proveedor no encontrado → `NotFoundException` 404 (permite proveedores inactivos).

#### PATCH /api/v1/admin/external-providers/:providerCode/cost-policy/:queryType

**Path params**: `providerCode` (string), `queryType` (string, sin validación Zod explícita — se usa tal cual, luego se uppercase internamente).
**Request body** (`providerCostPolicyPatchSchema`), todos opcionales:
| Campo | Tipo | Constraints |
|---|---|---|
| `unitCostAmount` | number | `>= 0` |
| `currency` | string | length 3 |
| `costTier` | enum | `FREE`\|`LOW`\|`MEDIUM`\|`HIGH`\|`CRITICAL` |
| `maxQueriesPerUserPerDay` | number entero \| null | positivo |
| `maxQueriesPerUserPerMonth` | number entero \| null | positivo |
| `maxQueriesGlobalPerDay` | number entero \| null | positivo |
| `allowedDecisionStagesJson` | array de string | cada uno min 2, max 80 |
| `requiresManualApproval` | boolean | — |
| `requiresAdminRole` | boolean | — |
| `blockByDefault` | boolean | — |
| `cacheTtlSeconds` | number entero \| null | `>= 0` |
| `featureTtlSeconds` | number entero \| null | `>= 0` |
| `retryMaxAttempts` | number entero \| null | `>= 0` |
| `retryBackoffSeconds` | number entero \| null | `>= 0` |
| `active` | boolean | — |

**Response 200**: objeto `costPolicy` actualizado.
**Errores**: proveedor no encontrado, o política para ese `queryType` no encontrada → `NotFoundException` 404 ("Política de costo no encontrada.").

#### POST /api/v1/admin/external-providers/:providerCode/test

**Propósito:** Disparar una ejecución de prueba contra un proveedor con valores por defecto razonables si no se especifican.
**Request body**: libre (`Record<string, unknown>`, sin Zod), con defaults: `customerId` default `"1"`, `queryType` default `"IDENTITY_VERIFICATION"`, `purpose` default `"MANUAL_REVIEW"`, `decisionStage` default `"MANUAL_REVIEW"`, `input` default `{}`.
**Response/Errores**: idénticos a `POST /external-data/requests`.

#### POST /api/v1/admin/external-providers/requests/:requestId/approve

**Request body**: `{ approvedByAdminId?: string (`^\d+$`), approvalReason?: string (max 240) }`.
**Response 200**: `{ requestId, approvalStatus: 'approved' }`. No re-ejecuta el proveedor.
**Errores**: solicitud no encontrada → `NotFoundException` 404.

#### POST /api/v1/admin/external-providers/requests/:requestId/retry

**Request body** (`retryRequestSchema`, todos opcionales salvo lo indicado): `providerCode?`, `queryType?`, `purpose?`, `decisionStage?`, `customerId?`, `input?` (recomendado/obligatorio en la práctica), `scenario?`, `approvedByAdminId?`.
**Response 200**: misma forma que `executeExternalDataRequest`.
**Errores**:
- Solicitud original no encontrada → `NotFoundException` 404.
- Sin `input` en el body → `BadRequestException` 400 ("RETRY_REQUIRES_NEW_INPUT: por privacidad no se guarda el input claro original; reenvía input sanitizado.") — el input original nunca se persiste en claro.
- Fuerza `forceRefresh: true` siempre (nunca usa caché en un retry).

#### POST /api/v1/admin/external-providers/requests/:requestId/rebuild-features

**Propósito:** Recalcular el snapshot de features de una solicitud ya ejecutada, sin volver a llamar al proveedor (usa las observaciones ya normalizadas y almacenadas).
**Response 200**: `{ requestId, providerCode, rebuilt: true, featureSnapshotId, features, missingFeaturesJson, note }`.
**Errores**:
- Solicitud no encontrada → `NotFoundException` 404.
- Solicitud sin `customerId` → `BadRequestException` 400 ("REQUEST_WITHOUT_CUSTOMER_CANNOT_REBUILD_FEATURES").
- Sin observaciones normalizadas almacenadas → `BadRequestException` 400 ("REQUEST_HAS_NO_NORMALIZED_OBSERVATIONS_TO_REBUILD").

---

### Sub-módulo: `KycExternalDataController` (`@Controller('kyc')`)

Roles de clase: `customer, internal_operator, risk_analyst, compliance_analyst, fraud_analyst, admin, platform_admin, system`.

#### POST /api/v1/kyc/segip/verify

**Propósito:** Verificar identidad de un cliente contra SEGIP (registro civil boliviano), vía el flujo genérico de `executeExternalDataRequest` con `providerCode=SEGIP`, `queryType=IDENTITY_VERIFICATION`, `purpose=KYC_ONBOARDING`, `decisionStage=ONBOARDING`.
**Auth:** `assertCustomerAccess(currentUser, body.customerId)`.
**Headers:** `x-tenant-id`, `x-idempotency-key` (opcional, mismo comportamiento de reuse/replay que en `requests`).

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| `customerId` | string | Sí | `^\d+$` | — |
| `documentNumber` | string | Sí | trim, min 3, max 30 | Número de documento de identidad. |
| `documentComplement` | string | No | max 10 | Complemento del CI. |
| `documentExtension` | string | No | max 10 | Extensión/expedido. |
| `firstName` | string | Sí | trim, min 1, max 120 | — |
| `lastName` | string | Sí | trim, min 1, max 120 | — |
| `birthDate` | string | No | `^\d{4}-\d{2}-\d{2}$` | — |
| `scenario` | string | No | max 80 | Escenario de mock. |

**Response/Errores**: idénticos a `POST /external-data/requests` (misma `status`/`observations`/`features`/`modeUsed`; consentimiento faltante → `status: 'CONSENT_REQUIRED'` en 200, no excepción).

---

### Sub-módulo: `BureauExternalDataController` (`@Controller('bureau')`)

Roles de clase: `admin, platform_admin, risk_analyst, compliance_analyst` (nota: **no incluye `customer`**, a diferencia de la mayoría de los demás sub-módulos).

#### POST /api/v1/bureau/infocenter/check

**Propósito:** Consultar el buró de crédito (Infocenter), proveedor de alto costo (`HIGH`/`CRITICAL` cost tier).
**Auth:** `assertCustomerAccess(currentUser, body.customerId)` (aunque en la práctica ningún rol `customer` tiene acceso a este controller por los `@Roles` de clase).
**Headers:** `x-tenant-id`, `x-idempotency-key` (opcional).

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| `customerId` | string | Sí | `^\d+$` | — |
| `documentNumber` | string | No | trim, min 3, max 30 | — |
| `decisionStage` | string | No | min 3, max 60, mayúsculas, default `"MANUAL_REVIEW"` | — |
| `approvedByAdminId` | string | No | `^\d+$` | Necesario para saltar el bloqueo de aprobación manual de este proveedor de alto costo. |
| `scenario` | string | No | max 80 | — |

**Response/Errores**: idénticos a `POST /external-data/requests` con `providerCode=INFOCENTER`, `queryType=CREDIT_REPORT`, `purpose=CREDIT_EVALUATION`.

---

### Sub-módulo: `PaymentsExternalDataController` (`@Controller('payments')`)

Roles de clase: `customer, internal_operator, risk_analyst, admin, platform_admin, system`.

#### POST /api/v1/payments/qr/verify

**Propósito:** Verificar un pago por QR (proveedor `QR_GENERIC`, `queryType=PAYMENT_VERIFICATION`, `purpose=PAYMENT_RECONCILIATION`, `decisionStage=PAYMENT_RECONCILIATION`).
**Headers:** `x-tenant-id`, `x-idempotency-key` (opcional).
**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| `customerId` | string | Sí | `^\d+$` | — |
| `amount` | number | Sí | `> 0` | Monto pagado. |
| `currency` | string | No | length 3, default `"BOB"` | — |
| `paymentReference` | string | Sí | trim, min 3, max 160 | Referencia/ID del pago QR. |
| `merchantId` | string | No | `^\d+$` | — |
| `purchaseId` | string | No | `^\d+$` | — |
| `paidAt` | string | No | max 40 | Timestamp libre del pago. |
| `scenario` | string | No | max 80 | — |

**Response/Errores**: idénticos a `POST /external-data/requests`.

#### POST /api/v1/payments/bank-transfer/verify

**Propósito:** Verificar una transferencia bancaria (proveedor `BANKING_GENERIC`, `queryType=BANK_TRANSFER_VERIFICATION`, `purpose=PAYMENT_RECONCILIATION`, `decisionStage=PAYMENT_RECONCILIATION`).
**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| `customerId` | string | Sí | `^\d+$` | — |
| `amount` | number | Sí | `> 0` | — |
| `currency` | string | No | length 3, default `"BOB"` | — |
| `transferReference` | string | Sí | trim, min 3, max 160 | — |
| `bankCode` | string | No | trim, min 2, max 80, default `"BANKING_GENERIC"` | — |
| `accountHolderName` | string | No | max 180 | — |
| `accountNumberHash` | string | No | max 128 | — |
| `scenario` | string | No | max 80 | — |

**Response/Errores**: idénticos a `POST /external-data/requests`.

---

### Sub-módulo: `TelcoExternalDataController` (`@Controller('telco')`)

Roles de clase: `customer, internal_operator, risk_analyst, fraud_analyst, admin, platform_admin, system`.

#### POST /api/v1/telco/phone-trust/verify

**Propósito:** Verificar confianza/fraude de un número telefónico (proveedor `TELCO_GENERIC`, `queryType=PHONE_TRUST_CHECK`, `purpose=FRAUD_PREVENTION`, `decisionStage=ONBOARDING`).
**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| `customerId` | string | Sí | `^\d+$` | — |
| `phoneNumber` | string | Sí | trim, min 8, max 30 | — |
| `documentNumber` | string | No | trim, min 3, max 30 | — |
| `operatorCode` | string | No | max 40 | — |
| `scenario` | string | No | max 80 | — |

**Response/Errores**: idénticos a `POST /external-data/requests`.

#### GET /api/v1/telco/phone-trust/:customerId

**Propósito:** Atajo de conveniencia — devuelve los features derivados de proveedores externos para el cliente (equivalente a `GET /external-data/users/:customerId/features`, no filtra solo features de telco).
**Path params**: `customerId` (string, `^\d+$`).
**Response/Errores**: idénticos a `GET /external-data/users/:customerId/features`.

---

### Sub-módulo: `FacebookExternalDataController` (`@Controller('social/facebook')`)

Roles de clase: `customer, internal_operator, risk_analyst, admin, platform_admin, system`.

#### GET /api/v1/social/facebook/connect-url

**Propósito:** Obtener la URL de conexión OAuth (mock/sandbox) para vincular la cuenta de Facebook de un cliente.
**Auth:** `assertCustomerAccess(currentUser, query.customerId)`.
**Headers:** `x-tenant-id`.
**Query params**: `customerId` (string, `^\d+$`, requerido).

**Response 200** (síncrono, sin acceso a BD):
| Campo | Tipo | Descripción |
|---|---|---|
| `customerId` | string | — |
| `providerCode` | `"FACEBOOK_META"` | — |
| `mode` | string | De env `FACEBOOK_META_MODE`/`META_FACEBOOK_MODE`, default `mock_local`. |
| `state` | string | Token aleatorio de 32 hex. |
| `connectUrl` | string | `/mock/facebook/oauth/authorize?state=...&customerId=...` — **no es una URL real de Meta en modo mock**. |
| `note` | string | Aclaración de que es mock/sandbox. |

**Errores**: acceso cruzado → 403.

#### POST /api/v1/social/facebook/callback

**Propósito:** Procesar el callback OAuth de Facebook (proveedor `FACEBOOK_META`, `queryType=SOCIAL_TRUST_CHECK`, `purpose=DIGITAL_TRUST`, `decisionStage=ONBOARDING`).
**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| `customerId` | string | Sí | `^\d+$` | — |
| `code` | string | No | trim, min 3, max 500 | Código de autorización OAuth. |
| `state` | string | No | max 500 | Token de estado devuelto por el paso `connect-url`. |
| `scenario` | string | No | max 80 | — |

**Response/Errores**: idénticos a `POST /external-data/requests`.

#### GET /api/v1/social/facebook/status/:customerId

Igual a `GET /telco/phone-trust/:customerId` (atajo a `getCustomerFeatures`, no filtra por proveedor).

---

### Sub-módulo: `WhatsappExternalDataController` (`@Controller('whatsapp')`)

Roles de clase: `customer, internal_operator, risk_analyst, admin, platform_admin, system`.

#### POST /api/v1/whatsapp/verification/start

**Propósito:** Iniciar verificación OTP por WhatsApp (proveedor `WHATSAPP_GENERIC`, `queryType=WHATSAPP_OTP_VERIFICATION`, `purpose=CONTACTABILITY`, `decisionStage=CONTACTABILITY`).
**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| `customerId` | string | Sí | `^\d+$` | — |
| `phoneNumber` | string | Sí | trim, min 8, max 30 | — |
| `channel` | literal | No | `"whatsapp"`, default `"whatsapp"` | — |
| `scenario` | string | No | max 80 | — |

**Response/Errores**: idénticos a `POST /external-data/requests`.

#### POST /api/v1/whatsapp/verification/confirm

**Propósito:** Confirmar el OTP recibido por WhatsApp (mismo mapeo de proveedor/queryType/purpose/decisionStage que `start`, ambos delegan al mismo `executeWhatsapp`).
**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| `customerId` | string | Sí | `^\d+$` | — |
| `phoneNumber` | string | Sí | trim, min 8, max 30 | — |
| `otpCode` | string | Sí | trim, min 4, max 12 | — |
| `verificationRef` | string | No | max 120 | — |
| `scenario` | string | No | max 80 | — |

**Response/Errores**: idénticos a `POST /external-data/requests`.

#### GET /api/v1/whatsapp/status/:customerId

Igual a `GET /telco/phone-trust/:customerId` (atajo a `getCustomerFeatures`).

---

### Sub-módulo: `DigitalTrustExternalDataController` (`@Controller('digital-trust')`)

Roles de clase: `customer, internal_operator, risk_analyst, fraud_analyst, admin, platform_admin, system`.

#### POST /api/v1/digital-trust/check

**Propósito:** Verificar confianza digital (email/teléfono/IP/fingerprint) contra el proveedor `DIGITAL_TRUST_GENERIC` (`queryType=DIGITAL_TRUST_CHECK`, `purpose=DIGITAL_TRUST`, `decisionStage=ONBOARDING`).
**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| `customerId` | string | Sí | `^\d+$` | — |
| `email` | string | No | trim, formato email | — |
| `phoneNumber` | string | No | trim, min 8, max 30 | — |
| `ipAddress` | string | No | max 80 | — |
| `deviceFingerprint` | string | No | max 180 | — |
| `scenario` | string | No | max 80 | — |

**Response/Errores**: idénticos a `POST /external-data/requests`.

#### GET /api/v1/digital-trust/profile/:customerId

Igual a `GET /telco/phone-trust/:customerId` (atajo a `getCustomerFeatures`).

---

## Resumen de endpoints documentados

| Módulo | Cantidad |
|---|---|
| Consents | 1 |
| Sessions | 4 |
| Risk | 3 |
| External Data (8 sub-controllers) | 40 |
| **Total** | **48** |

---

<a id="modulo-04"></a>

# Contrato HTTP: Operations, Data Quality, Audit, Catalog Management

Prefijo global: `/api/v1` (`env.API_PREFIX`, default `api/v1`, configurable vía `API_PREFIX`).

Notas transversales:

- **Auth por defecto de estos 4 controladores:** todos usan `@UseGuards(JwtAuthGuard, RolesGuard)` explícito a nivel de clase (no dependen del guard global). Ninguno tiene `@Public()`.
- `JwtAuthGuard`: exige header `Authorization: Bearer <jwt>`. Verifica firma HS256 contra `JWT_ACCESS_TOKEN_SECRET`. Si el payload trae `tokenVersion`, lo compara contra la versión vigente en `auth_credentials` (revocación de tokens). Errores: `401 Unauthorized` si falta el header, formato inválido, token inválido/expirado o token revocado.
- `RolesGuard`: lee metadata `@Roles(...)` (acumulada por handler + clase vía `getAllAndOverride`). Si el rol del usuario autenticado no está en la lista permitida → `403 Forbidden` ("El usuario autenticado no tiene permiso para esta operación.").
- Header `x-tenant-id`: en `operations`, `data-quality` y `audit` se lee manualmente del header y se valida con `parsePositiveId` (regex `^[1-9][0-9]*$`). Si falta o no es un entero positivo en texto → `400 Bad Request` ("x-tenant-id debe ser un entero positivo representado como texto."). En `catalog-management`, el tenant también se extrae del header pero solo se usa para auditoría/registro de cambios (`context.tenantId`), no para filtrar consultas — las operaciones de catálogo son multi-tenant a nivel de plataforma.
- Header `x-idempotency-key`: requerido en todos los endpoints de escritura (`POST`) de estos 4 controladores. Si falta → `400 Bad Request` ("X-Idempotency-Key header is required."). Se usa para hash de auditoría (`sha256Hex`), no hay verificación de idempotencia real (no se rechaza una key repetida) en el código revisado.
- Validación de query/params/body: todos usan `ZodValidationPipe`. Si falla, `400 Bad Request` con body `{ message: "Entrada inválida en <query|param|body>.", issues: [{ path, message }] }`.
- IDs (customerId, caseId, issueId, versionId, rulesetVersionId, etc.) se validan como strings que matchean `^[1-9][0-9]*$` (enteros positivos representados como texto, por precisión con bigint). No son números JS.
- Catalog Management además exige rol interno/sistema en el propio servicio: `assertInternal(currentUser)` (usa `isInternalOrSystemRole`) lanza `403 Forbidden` ("Este endpoint es interno.") como defensa en profundidad además del `@Roles(...)` del controller.

---

## Módulo: Operations (`operations.controller.ts`)

Guard de clase: `JwtAuthGuard`, `RolesGuard`. Rol base de clase: `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` (algunos endpoints amplían/restringen con `@Roles` de método).

### GET /api/v1/operations/work-queue

**Propósito:** Listar en una sola cola combinada (paginada por offset) los casos de revisión manual y de fraude pendientes de trabajo operativo.
**Auth:** JwtAuthGuard + RolesGuard. Roles: `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` (heredado de la clase, sin override de método).
**Headers:** `authorization` (Bearer JWT); `x-tenant-id` (requerido, entero positivo en texto).

**Path params**
Ninguno.

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| queue | enum('manual_review','fraud','all') | No | `all` | Filtra por tipo de cola; `all` mezcla y ordena ambas fuentes en memoria. |
| status | string (1-40) | No | — | Filtro de estado del caso. |
| priority | string (1-40) | No | — | Filtro de prioridad. |
| customerId | string `^[1-9][0-9]*$` | No | — | Filtra por cliente. |
| page | int positivo (coerce) | No | 1 | Página (offset-based). |
| limit | int positivo, max 100 (coerce) | No | 20 | Tamaño de página. |
| sortBy | enum('createdAt','updatedAt') | No | `createdAt` | Campo de orden. |
| sortOrder | enum('asc','desc') | No | `desc` | Dirección de orden. |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| items | WorkQueueItemDto[] | Ítems de la cola (mezclados si `queue=all`). |
| items[].workItemType | 'manual_review' \| 'fraud' | Tipo de ítem. |
| items[].caseId | string | ID del caso. |
| items[].caseCode | string \| null | Código legible del caso. |
| items[].customerId | string \| null | Cliente asociado. |
| items[].priority | string \| null | Prioridad (manual_review) o severidad (fraud, reutiliza el campo `priority`). |
| items[].status | string \| null | Estado del caso (`status` en manual_review, `caseStatus` en fraud). |
| items[].reasonCode | string \| null | `caseType` (manual_review) o `patternDetected` (fraud). |
| items[].openedAt | string(ISO) \| null | Fecha de apertura. |
| items[].createdAt | string(ISO) | Fecha de creación. |
| meta | PaginationMeta | `{ page, limit, total, totalPages }`. Con `queue=all`, `total` es la suma de ambas fuentes. |

**Errores**
- Falta o `x-tenant-id` inválido → `400 Bad Request`.
- Query inválida (p.ej. `limit` > 100) → `400 Bad Request` (Zod).
- Rol no permitido → `403 Forbidden`.
- Sin JWT válido → `401 Unauthorized`.

---

### GET /api/v1/operations/manual-review-cases

**Propósito:** Variante por cursor (keyset pagination) de la cola de revisión manual, pensada para reemplazar `work-queue?queue=manual_review` cuando el volumen haga costoso el `OFFSET`.
**Auth:** JwtAuthGuard + RolesGuard. Roles heredados de la clase (mismos 5 roles).
**Headers:** `authorization`; `x-tenant-id` (requerido).

**Path params**
Ninguno.

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| status | string (1-40) | No | — | Filtro de estado. |
| priority | string (1-40) | No | — | Filtro de prioridad. |
| customerId | string `^[1-9][0-9]*$` | No | — | Filtro por cliente. |
| limit | int positivo, max 100 (coerce) | No | 20 | Tamaño de página. |
| sortBy | enum('createdAt','updatedAt') | No | `createdAt` | Campo de orden. |
| cursor | string (1-500) | No | — | Cursor opaco de la página anterior (`nextCursor`). |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| items | WorkQueueItemDto[] | Igual forma que en `work-queue`, `workItemType` siempre `'manual_review'`. |
| nextCursor | string \| null | Cursor para la siguiente página; `null` si no hay más. |

**Errores**
- Igual patrón que `work-queue` (400 tenant/query, 401, 403). No soporta `queue=all` (deliberadamente, ver comentario en el código).

---

### GET /api/v1/operations/fraud-cases

**Propósito:** Variante por cursor de la cola de casos de fraude.
**Auth:** JwtAuthGuard + RolesGuard. **Override de método:** `@Roles('fraud_analyst', 'internal_operator', 'risk_analyst', 'compliance_analyst', 'admin', 'platform_admin')` (agrega `fraud_analyst` respecto al default de clase).
**Headers:** `authorization`; `x-tenant-id` (requerido).

**Path params**
Ninguno.

**Query params**
Idénticos a `GET /operations/manual-review-cases` (mismo `cursorWorkQueueQuerySchema`).

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| items | WorkQueueItemDto[] | `workItemType` siempre `'fraud'`; `priority` = `severity`, `status` = `caseStatus`, `reasonCode` = `patternDetected`. |
| nextCursor | string \| null | Cursor para la siguiente página. |

**Errores**
Igual patrón que los anteriores.

---

### GET /api/v1/operations/customers/:customerId/investigation-summary

**Propósito:** Resumen de investigación de un cliente para el panel de operaciones: perfil, contactos, consentimientos, última evaluación de riesgo y casos abiertos (manual review + fraude).
**Auth:** JwtAuthGuard + RolesGuard. Roles heredados de clase.
**Headers:** `authorization`; `x-tenant-id` (requerido).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| customerId | string `^[1-9][0-9]*$` | ID del cliente. |

**Query params**
Ninguno.

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| customer.customerId | string | ID del cliente. |
| customer.customerCode | string \| null | Código de cliente. |
| customer.status | string \| null | `lifecycleStatus`. |
| customer.phoneLast4 | string \| null | Últimos 4 dígitos de teléfono principal. |
| customer.emailDomain | string \| null | Dominio del email principal. |
| customer.createdAt | string(ISO) | Fecha de alta. |
| profile | object \| null | `{ firstName, lastName, birthDate, preferredLanguage }` o `null` si no hay perfil vigente. |
| contacts | ContactSummaryDto[] | `{ contactType, status, isPrimary, valueLast4 }`. |
| consents | ConsentSummaryDto[] | `{ purposeCode, granted, grantedAt, revokedAt }`. |
| latestRiskAssessment | RiskSummaryDto \| null | `{ riskAssessmentRunId, assessmentType, recommendedAction, riskLevel, fraudScore(number\|null), decidedAt }`. |
| manualReviewCases | ManualReviewSummaryDto[] | `{ caseId, caseCode, caseType, priority, status, openedAt }` (solo casos abiertos). |
| fraudCases | FraudCaseSummaryDto[] | `{ caseId, caseCode, severity, caseStatus, openedAt }`. |

**Errores**
- Cliente no encontrado (por tenant + id) → `404 Not Found` ("Cliente no encontrado.").
- `x-tenant-id` inválido/faltante → `400 Bad Request`.

---

### POST /api/v1/operations/manual-review-cases/:caseId/decision

**Propósito:** Registrar la decisión de un operador sobre un caso de revisión manual (aprobar, rechazar, pedir más info, escalar a fraude, sin acción), cerrando el caso y opcionalmente cambiando el estado del cliente.
**Auth:** JwtAuthGuard + RolesGuard. **Override de método:** `@Roles('internal_operator', 'risk_analyst', 'admin', 'platform_admin')` (más restrictivo que el default de clase: excluye `compliance_analyst`).
**Headers:** `authorization`; `x-tenant-id` (requerido); `x-idempotency-key` (**requerido**, si falta → 400).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| caseId | string `^[1-9][0-9]*$` | ID del caso de revisión manual. |

**Query params**
Ninguno.

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| decision | enum | Sí | `approved`\|`rejected`\|`request_more_information`\|`escalated_to_fraud`\|`no_action` | Decisión tomada. |
| reasonCode | string | Sí | trim, 1-120 | Código de motivo. |
| notes | string | No | trim, max 2000 | Notas libres. **Obligatorio en la práctica** si `decision` es `rejected` o `request_more_information` (validado en servicio, no en el schema Zod). |
| nextCustomerStatus | enum | No | `approved_for_next_step`\|`rejected`\|`pending_more_information`\|`pending_fraud_review`\|`registered` | Si se envía y el caso tiene cliente asociado, dispara un cambio de estado de cliente + observación. |

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| caseId | string | ID del caso decidido. |
| customerId | string \| null | Cliente asociado al caso. |
| decision | string | Eco de la decisión enviada. |
| caseStatus | string | Siempre `'closed'`. |
| nextCustomerStatus | string \| null | Eco del valor enviado o `null`. |

**Errores**
- Falta `x-idempotency-key` → `400 Bad Request`.
- `decision` es `rejected`/`request_more_information` sin `notes` → `422 Unprocessable Entity` (`DECISION_REASON_REQUIRED`).
- Caso no encontrado (por tenant) → `404 Not Found` (`CASE_NOT_FOUND`).
- Caso ya cerrado (`closedAt` seteado o `status==='closed'`) → `409 Conflict` (`CASE_ALREADY_CLOSED`).

---

### POST /api/v1/operations/fraud-cases/:caseId/decision

**Propósito:** Registrar la decisión de un analista de fraude sobre un caso (confirmado, falso positivo, requiere más investigación, bloqueado, escalado), con opción de aplicar watchlist. Ruta mantenida en `operations` por compatibilidad; la lógica vive en `FraudService`.
**Auth:** JwtAuthGuard + RolesGuard. **Override de método:** `@Roles('fraud_analyst', 'admin', 'platform_admin')`.
**Headers:** `authorization`; `x-tenant-id` (requerido); `x-idempotency-key` (**requerido**).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| caseId | string `^[1-9][0-9]*$` | ID del caso de fraude. |

**Query params**
Ninguno.

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| decision | enum | Sí | `confirmed_fraud`\|`false_positive`\|`needs_more_investigation`\|`blocked`\|`escalated` | Decisión del analista. |
| reasonCode | string | Sí | trim, 1-120 | Código de motivo. Requerido de forma efectiva si `decision` es `confirmed_fraud`/`blocked` (chequeo adicional en servicio, redundante porque el schema ya lo exige siempre). |
| applyWatchlist | boolean | No | default `false` | Si `true`, crea entrada en watchlist (hash del `customerId`). |
| nextCustomerStatus | enum | No | `blocked`\|`pending_fraud_review`\|`registered`\|`approved_for_next_step` | Cambia estado del cliente si aplica. |
| notes | string | No | trim, max 2000 | Notas libres. |

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| caseId | string | ID del caso. |
| customerId | string \| null | Cliente asociado. |
| decision | string | Eco de la decisión. |
| caseStatus | string | `'in_progress'` si `decision==='needs_more_investigation'`, si no `'closed'`. |
| watchlistApplied | boolean | Si se creó entrada de watchlist. |
| nextCustomerStatus | string \| null | Eco del valor enviado o `null`. |

**Errores**
- Falta `x-idempotency-key` → `400 Bad Request`.
- `decision` es `confirmed_fraud`/`blocked` sin `reasonCode` → `422 Unprocessable Entity` (`FRAUD_REASON_REQUIRED`) (en la práctica inalcanzable porque `reasonCode` es siempre requerido por Zod).
- Caso no encontrado → `404 Not Found` (`FRAUD_CASE_NOT_FOUND`).
- Caso ya cerrado → `409 Conflict` (`CASE_ALREADY_CLOSED`).

---

## Módulo: Data Quality (`data-quality.controller.ts`)

Controller path: `operations/data-quality/issues`. Guard de clase: `JwtAuthGuard`, `RolesGuard`. Roles: `internal_operator`, `risk_analyst`, `compliance_analyst`, `admin`, `platform_admin` (sin overrides de método).

### GET /api/v1/operations/data-quality/issues

**Propósito:** Listar issues de calidad de datos detectados (paginado por offset), para triage operativo.
**Auth:** JwtAuthGuard + RolesGuard, roles de clase.
**Headers:** `authorization`; `x-tenant-id` (requerido).

**Path params**
Ninguno.

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| status | string (1-40) | No | — | Filtro de estado del issue. |
| severity | string (1-40) | No | — | Filtro de severidad (no implementado en el mapeo de respuesta actual, ver nota abajo). |
| entityType | string (1-120) | No | — | Filtro de tipo de entidad afectada. |
| customerId | string `^[1-9][0-9]*$` | No | — | Filtro por cliente. |
| page | int positivo (coerce) | No | 1 | Página. |
| limit | int positivo, max 100 (coerce) | No | 20 | Tamaño de página. |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| items | array | Lista de issues. |
| items[].issueId | string | ID del issue. |
| items[].severity | null | **Siempre `null`** en la implementación actual del mapeo (campo reservado, no poblado desde el modelo). |
| items[].entityType | string \| null | `targetTable` del registro afectado. |
| items[].entityId | string \| null | `targetRecordId`. |
| items[].issueCode | string \| null | Reutiliza `issueStatus` (mismo valor que `status`, no hay un código de issue separado en el mapeo actual). |
| items[].status | string \| null | `issueStatus`. |
| items[].detectedAt | string(ISO) \| null | Fecha de detección. |
| items[].resolvedAt | string(ISO) \| null | Fecha de resolución, `null` si sigue abierto. |
| meta | PaginationMeta | `{ page, limit, total, totalPages }`. |

**Errores**
- `x-tenant-id` inválido/faltante → `400 Bad Request`.

---

### POST /api/v1/operations/data-quality/issues/:issueId/resolve

**Propósito:** Resolver o descartar (`ignored`) un issue de calidad de datos, dejando trazabilidad de auditoría y de cambio de datos.
**Auth:** JwtAuthGuard + RolesGuard, roles de clase.
**Headers:** `authorization`; `x-tenant-id` (requerido); `x-idempotency-key` (**requerido**).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| issueId | string `^[1-9][0-9]*$` | ID del issue de calidad de datos. |

**Query params**
Ninguno.

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| resolution | enum | Sí | `resolved`\|`ignored` | Resultado de la revisión. |
| reasonCode | string | Sí | trim, 1-120 | Código de motivo. |
| notes | string | Sí | trim, 1-2000 | Notas obligatorias (a diferencia de otros endpoints de decisión, aquí `notes` no es opcional). |

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| issueId | string | ID del issue resuelto. |
| status | string | Eco de `resolution` enviada (`resolved` o `ignored`). |

**Errores**
- Falta `x-idempotency-key` → `400 Bad Request`.
- Issue no encontrado (por tenant) → `404 Not Found` (`DATA_QUALITY_ISSUE_NOT_FOUND`).
- Issue ya resuelto (`resolvedAt` seteado) → `409 Conflict` (`DATA_QUALITY_ISSUE_ALREADY_RESOLVED`).

---

## Módulo: Audit (`audit.controller.ts`)

Controller path: `operations/audit`. Guard de clase: `JwtAuthGuard`, `RolesGuard`. Roles: `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`.

### GET /api/v1/operations/audit/customer/:customerId

**Propósito:** Timeline de eventos de auditoría de un cliente (status, auth, consent, risk, manual_review, fraud, data_change, customer_action), consolidado desde 5 fuentes, paginado por offset **en memoria** (se traen todas las filas del rango de fecha y se recorta con `slice`).
**Auth:** JwtAuthGuard + RolesGuard, roles de clase.
**Headers:** `authorization`; `x-tenant-id` (requerido).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| customerId | string `^[1-9][0-9]*$` | ID del cliente. |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| eventType | enum | No | `all` | `all`\|`status`\|`auth`\|`consent`\|`risk`\|`manual_review`\|`fraud`\|`data_change`\|`customer_action`. |
| from | string (ISO datetime) | No | — | Filtro de fecha inicial. |
| to | string (ISO datetime) | No | — | Filtro de fecha final. |
| page | int positivo (coerce) | No | 1 | Página. |
| limit | int positivo, max 100 (coerce) | No | 50 | Tamaño de página. |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| events | array | Página de eventos. |
| events[].eventType | string | Tipo de evento. |
| events[].occurredAt | string(ISO) | Fecha/hora del evento. |
| events[].actorType | string | Rol/tipo de actor que generó el evento. |
| events[].summary | string | Resumen textual del evento. |
| meta | PaginationMeta | `{ page, limit, total, totalPages }`; `total` es el conteo total de filas antes de paginar (de las 5 fuentes combinadas). |

**Errores**
- `x-tenant-id` inválido/faltante → `400 Bad Request`.

---

### GET /api/v1/operations/audit/customer/:customerId/feed

**Propósito:** Variante por cursor real (respaldada por la vista SQL `audit_event_feed`, que cubre 8 fuentes en vez de 5) del timeline de auditoría de un cliente. Pensada para reemplazar gradualmente al endpoint offset-based anterior.
**Auth:** JwtAuthGuard + RolesGuard, roles de clase.
**Headers:** `authorization`; `x-tenant-id` (requerido).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| customerId | string `^[1-9][0-9]*$` | ID del cliente. |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| limit | int positivo, max 100 (coerce) | No | 50 | Tamaño de página. |
| cursor | string (1-500) | No | — | Cursor opaco de la página anterior. |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| events | array | Página de eventos desde la vista `audit_event_feed`. |
| events[].sourceTable | string | Tabla de origen del evento (`source_table`). |
| events[].eventType | string | Tipo de evento. |
| events[].occurredAt | string(ISO) | Fecha/hora. |
| events[].actorType | string | Tipo de actor. |
| events[].targetType | string | Tipo de entidad objetivo del evento. |
| events[].targetId | string | ID de la entidad objetivo. |
| nextCursor | string \| null | Cursor para la siguiente página. |

**Errores**
- `x-tenant-id` inválido/faltante → `400 Bad Request`.

---

## Módulo: Catalog Management (`catalog-management.controller.ts`)

Controller path: `operations`. Guard de clase: `JwtAuthGuard`, `RolesGuard`. Roles: `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system` (sin overrides de método). **Además**, cada método de servicio llama `assertInternal(currentUser)`, que exige un rol interno/sistema (`isInternalOrSystemRole`) — `403 Forbidden` ("Este endpoint es interno.") si no se cumple, como capa adicional independiente del `RolesGuard`.

`x-tenant-id` en este módulo no filtra las consultas (los catálogos son globales a la plataforma); solo se usa para poblar `context.tenantId` en los registros de auditoría/data-change de los endpoints de escritura.

### GET /api/v1/operations/catalogs

**Propósito:** Listar catálogos de contexto (p.ej. listas de riesgo, catálogos de terceros) junto con su versión vigente.
**Auth:** JwtAuthGuard + RolesGuard (roles de clase) + `assertInternal` en servicio.
**Headers:** `authorization`. (`x-tenant-id` no se lee en este endpoint.)

**Path params**
Ninguno.

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| domain | string (2-80) | No | — | Filtro de dominio de negocio del catálogo. |
| status | enum | No | `all` | `draft`\|`pending_approval`\|`approved`\|`published`\|`retired`\|`all`; filtra por el estado de la **versión vigente**. |
| active | enum('true','false','all') | No | `all` | (Aceptado por el schema; no se aplica como filtro en la implementación actual del servicio — solo `status` y `domain` se usan para filtrar). |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| items | array | Catálogos que matchean el filtro. |
| items[].catalogId | string | ID del catálogo. |
| items[].catalogCode | string | Código único. |
| items[].catalogName | string | Nombre. |
| items[].domain | string | Dominio de negocio. |
| items[].description | string \| null | Descripción. |
| items[].ownerTeam | string \| null | Equipo dueño. |
| items[].isActive | boolean | Si el catálogo está activo. |
| items[].currentVersion | object \| null | `{ catalogVersionId, versionCode, status, validFrom, validUntil }` de la versión más reciente, o `null` si no tiene ninguna. |

**Errores**
- Rol no interno/sistema → `403 Forbidden`.

---

### GET /api/v1/operations/catalogs/:catalogCode/versions/:versionId

**Propósito:** Obtener el detalle completo de una versión de catálogo: metadatos de versión + ítems + sus alias y mapeos de riesgo.
**Auth:** JwtAuthGuard + RolesGuard + `assertInternal`.
**Headers:** `authorization`.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| catalogCode | string, 2-140, regex `^[a-zA-Z0-9_.:-]+$` | Código del catálogo. |
| versionId | string `^[1-9][0-9]*$` | ID de la versión. |

**Query params**
Ninguno.

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| catalog | object | Mismo shape que un ítem de `GET /catalogs` (`catalogId`, `catalogCode`, `catalogName`, `domain`, `description`, `ownerTeam`, `isActive`, `currentVersion`). |
| version | object | `{ catalogVersionId, versionCode, status, validFrom, validUntil, approvedAt, notes }`. |
| items | array | Ítems de la versión. |
| items[].contextItemId | string | ID del ítem. |
| items[].itemCode | string | Código del ítem. |
| items[].itemName | string | Nombre. |
| items[].itemType | string | Tipo. |
| items[].attributes | object | Atributos JSON libres. |
| items[].sourceId | string \| null | ID de la fuente. |
| items[].confidenceScore | string \| null | Score de confianza (decimal como texto). |
| items[].isActive | boolean | Si el ítem está activo. |
| items[].aliases | array | `{ aliasId, aliasValue, aliasType, normalizedAlias, confidenceScore }`. |
| items[].riskMappings | array | `{ riskMappingId, riskDimension, riskBand, scorePointsSuggested, reasonCode, explanation, modelUsage, validFrom, validUntil }`. |

**Errores**
- Catálogo no encontrado → `404 Not Found` ("Catálogo no encontrado.").
- Versión no encontrada → `404 Not Found` ("Versión de catálogo no encontrada.").
- Rol no interno/sistema → `403 Forbidden`.

---

### POST /api/v1/operations/catalogs/:catalogCode/versions

**Propósito:** Crear una nueva versión en borrador (`draft`) de un catálogo, con sus ítems, alias y mapeos de riesgo iniciales.
**Auth:** JwtAuthGuard + RolesGuard + `assertInternal`.
**Headers:** `authorization`; `x-tenant-id` (para auditoría); `x-idempotency-key` (**requerido**).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| catalogCode | string, 2-140, regex código | Código del catálogo destino. |

**Query params**
Ninguno.

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| versionCode | string | Sí | 2-60 | Código de la nueva versión. |
| validFrom | string (YYYY-MM-DD) | No | regex fecha | Inicio de vigencia. |
| validUntil | string (YYYY-MM-DD) | No | regex fecha | Fin de vigencia. |
| notes | string | No | max 4000 | Notas de la versión. |
| items | array | Sí | 1-500 | Ítems del catálogo. |
| items[].itemCode | string | Sí | 2-140, regex código | Código del ítem. |
| items[].itemName | string | Sí | 1-220 | Nombre del ítem. |
| items[].itemType | string | Sí | 2-80 | Tipo de ítem. |
| items[].sourceCode | string | No | regex código | Código de fuente (se resuelve a `sourceId` internamente). |
| items[].confidenceScore | string | No | regex `^\d{1,3}(\.\d{1,2})?$` | Score de confianza. |
| items[].attributes | object | No | default `{}` | Atributos libres. |
| items[].aliases | array | No | max 50, default `[]` | `{ aliasValue(1-220), aliasType(2-60, default 'common_name'), confidenceScore? }`. |
| items[].riskMappings | array | No | max 50, default `[]` | `{ riskDimension(2-60), riskBand(2-40), scorePointsSuggested?, reasonCode(2-100), explanation?(max2000), modelUsage?(2-80), validFrom?, validUntil? }`. |

**Response 201**
| Campo | Tipo | Descripción |
|---|---|---|
| catalogCode | string | Eco del código de catálogo. |
| catalogVersionId | string | ID de la versión creada. |
| status | string | Siempre `'draft'` al crear. |
| itemsCreated | number | Cantidad de ítems creados. |
| aliasesCreated | number | Cantidad de alias creados. |
| riskMappingsCreated | number | Cantidad de mapeos de riesgo creados. |

**Errores**
- Falta `x-idempotency-key` → `400 Bad Request`.
- Catálogo no encontrado → `404 Not Found` ("Catálogo no encontrado.").
- Rol no interno/sistema → `403 Forbidden`.

---

### POST /api/v1/operations/catalogs/:catalogCode/versions/:versionId/submit-for-approval

**Propósito:** Enviar una versión en borrador a aprobación (transición `draft` → `pending_approval`).
**Auth:** JwtAuthGuard + RolesGuard + `assertInternal`.
**Headers:** `authorization`; `x-tenant-id`; `x-idempotency-key` (**requerido**).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| catalogCode | string | Código del catálogo. |
| versionId | string `^[1-9][0-9]*$` | ID de la versión. |

**Query params**
Ninguno.

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| notes | string | Sí | 3-2000 | Motivo/notas del envío a aprobación. |

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| catalogVersionId | string | ID de la versión. |
| status | string | Nuevo estado, `'pending_approval'`. |

**Errores**
- Falta `x-idempotency-key` → `400 Bad Request`.
- Catálogo no encontrado → `404 Not Found`.
- Versión no encontrada → `404 Not Found`.
- Versión no está en `draft` → `422 Unprocessable Entity` (`CATALOG_VERSION_NOT_DRAFT`).
- Versión sin ítems → `422 Unprocessable Entity` (`CATALOG_VERSION_WITHOUT_ITEMS`).

---

### POST /api/v1/operations/catalogs/:catalogCode/versions/:versionId/decision

**Propósito:** Decidir sobre una versión de catálogo: aprobar, rechazar, publicar o retirar.
**Auth:** JwtAuthGuard + RolesGuard + `assertInternal`.
**Headers:** `authorization`; `x-tenant-id`; `x-idempotency-key` (**requerido**).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| catalogCode | string | Código del catálogo. |
| versionId | string `^[1-9][0-9]*$` | ID de la versión. |

**Query params**
Ninguno.

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| decision | enum | Sí | `approve`\|`reject`\|`publish`\|`retire` | Decisión a aplicar. |
| decisionReason | string | Sí | 5-3000 | Motivo de la decisión. |
| validFrom | string (YYYY-MM-DD) | No | regex fecha | Sobrescribe inicio de vigencia. |
| validUntil | string (YYYY-MM-DD) | No | regex fecha | Sobrescribe fin de vigencia. |

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| catalogVersionId | string | ID de la versión. |
| decision | string | Eco de la decisión. |
| status | string | Nuevo estado: `approved`\|`rejected`\|`published`\|`retired` según `decision`. |
| publishedAt | string(ISO) \| null | Timestamp si `decision==='publish'`, si no `null`. |

**Errores**
- Falta `x-idempotency-key` → `400 Bad Request`.
- Catálogo o versión no encontrados → `404 Not Found`.
- `decision==='publish'` y estado actual no es `approved` ni `pending_approval` → `422 Unprocessable Entity` (`CATALOG_VERSION_NOT_READY_TO_PUBLISH`).
- `decision==='approve'` y estado actual no es `pending_approval` → `422 Unprocessable Entity` (`CATALOG_VERSION_NOT_PENDING_APPROVAL`).

---

### POST /api/v1/operations/catalog-ingestions

**Propósito:** Registrar un lote de ingesta cruda de un catálogo (p.ej. de un proveedor externo), creando un job de ingesta y ítems en staging para revisión posterior.
**Auth:** JwtAuthGuard + RolesGuard + `assertInternal`.
**Headers:** `authorization`; `x-tenant-id`; `x-idempotency-key` (**requerido**).

**Path params**
Ninguno.

**Query params**
Ninguno.

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| catalogCode | string | Sí | 2-140, regex código | Catálogo destino. |
| sourceType | string | Sí | 2-60 | Tipo de fuente. |
| sourceName | string | Sí | 2-160 | Nombre de la fuente. |
| sourceCode | string | No | regex código | Código de fuente; si falta se genera uno derivado del hash de `sourceName`. |
| items | array | Sí | 1-1000 | Ítems crudos a poner en staging. |
| items[].rawValue | string | Sí | 1-500 | Valor crudo recibido. |
| items[].normalizedValue | string | No | regex código | Valor normalizado propuesto (`proposedItemCode`). |
| items[].itemType | string | Sí | 2-80 | Tipo de ítem. |
| items[].confidenceScore | string | No | regex decimal | Score de confianza. |
| items[].rawPayload | object | No | default `{}` | Payload crudo original. |
| items[].aiSuggested | boolean | No | default `false` | Si el valor fue sugerido por IA. |

**Response 201**
| Campo | Tipo | Descripción |
|---|---|---|
| ingestionJobId | string | ID del job de ingesta creado. |
| status | string | Siempre `'completed'` (el job se marca completado sincrónicamente tras crear los staging items). |
| stagingItemsCreated | number | Cantidad de ítems creados en staging. |

**Errores**
- Falta `x-idempotency-key` → `400 Bad Request`.
- Catálogo no encontrado → `404 Not Found` ("Catálogo no encontrado.").

---

### POST /api/v1/operations/catalog-staging-items/decision-batch

**Propósito:** Aprobar o rechazar en lote ítems en staging (provenientes de una ingesta), promoviendo los aprobados a ítems reales de una versión de catálogo destino.
**Auth:** JwtAuthGuard + RolesGuard + `assertInternal`.
**Headers:** `authorization`; `x-tenant-id`; `x-idempotency-key` (**requerido**).

**Path params**
Ninguno.

**Query params**
Ninguno.

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| targetCatalogVersionId | string `^[1-9][0-9]*$` | Sí | — | Versión de catálogo destino donde se crean los ítems aprobados. |
| decisions | array | Sí | 1-500 | Lote de decisiones. |
| decisions[].stagingItemId | string `^[1-9][0-9]*$` | Sí | — | ID del ítem en staging. |
| decisions[].decision | enum | Sí | `approve`\|`reject` | Decisión. |
| decisions[].itemCode | string | No | regex código | Código final del ítem (si se aprueba); si falta usa el propuesto en staging. |
| decisions[].itemName | string | No | 1-220 | Nombre final del ítem. |
| decisions[].itemType | string | No | 2-80 | Tipo final del ítem. |
| decisions[].decisionReason | string | Sí | 5-2000 | Motivo de la decisión. |
| decisions[].aliases | array | No | max 50, default `[]` | Mismo shape que en `createCatalogVersion`. |
| decisions[].riskMappings | array | No | max 50, default `[]` | Mismo shape que en `createCatalogVersion`. |

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| processed | number | Total de decisiones procesadas. |
| approved | number | Cantidad aprobadas. |
| rejected | number | Cantidad rechazadas. |
| itemsCreated | number | Ítems de catálogo reales creados a partir de aprobaciones. |

**Errores**
- Falta `x-idempotency-key` → `400 Bad Request`.
- Versión destino no encontrada → `404 Not Found` ("Versión destino no encontrada.").
- Versión destino no editable (no está en `draft`/`pending_approval`) → `422 Unprocessable Entity` (`TARGET_VERSION_NOT_EDITABLE`).
- Algún `stagingItemId` no encontrado → `404 Not Found` (`Staging item {id} no encontrado.`).
- Ítem aprobado sin `itemCode`/`itemName` resolubles (ni en decision ni en staging) → `422 Unprocessable Entity` (`APPROVED_STAGING_ITEM_REQUIRES_ITEM_CODE_AND_NAME`).

---

### GET /api/v1/operations/definitions

**Propósito:** Listar definiciones de negocio del catálogo de datos: observaciones, eventos, atributos y features.
**Auth:** JwtAuthGuard + RolesGuard + `assertInternal`.
**Headers:** `authorization`.

**Path params**
Ninguno.

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| type | enum | No | `all` | `observation`\|`event`\|`attribute`\|`feature`\|`all`. |
| status | enum | No | `all` | `active`\|`inactive`\|`all`. |
| domain | string (2-80) | No | — | Filtro de dominio. |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| observations | array | `{ observationDefinitionId, observationCode, observationName, dataType, sourceGroup, riskDimension, isActive }`. |
| events | array | `{ eventDefinitionId, eventCode, eventName, eventFamily, sourcePackage, riskDimension, isHighVolume, isActive }`. |
| attributes | array | `{ attributeDefinitionId, attributeCode, attributeName, entityScope, dataType, riskDimension, isSensitive, isActive }`. |
| features | array | `{ featureDefinitionId, featureCode, featureName, featureFamily, riskDimension, dataType, isModelInput, isPolicyRuleInput, isActive }`. |

**Errores**
- Rol no interno/sistema → `403 Forbidden`.

---

### POST /api/v1/operations/definitions/package

**Propósito:** Dar de alta/actualizar (upsert) en lote definiciones de eventos, observaciones, atributos y features para un dominio de negocio.
**Auth:** JwtAuthGuard + RolesGuard + `assertInternal`.
**Headers:** `authorization`; `x-tenant-id`; `x-idempotency-key` (**requerido**).

**Path params**
Ninguno.

**Query params**
Ninguno.

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| domain | string | Sí | 2-80 | Dominio de negocio del paquete. |
| definitions.events | array | No | max 300, default `[]` | Cada uno extiende `definitionBase` + `{ eventCode, eventName, eventFamily?, sourcePackage?, targetTables?(string[]), expectedPayloadSchema?(object), isHighVolume? }`. |
| definitions.observations | array | No | max 300, default `[]` | `definitionBase` + `{ observationCode, observationName, sourceGroup?, expectedAvailabilityStage? }`. |
| definitions.attributes | array | No | max 300, default `[]` | `definitionBase` + `{ attributeCode, attributeName, entityScope?, sourceType?, availabilityStage?, isModelCandidate? }`. |
| definitions.features | array | No | max 300, default `[]` | `definitionBase` + `{ featureCode, featureName, featureFamily?, availabilityTier?, calculationKind?, defaultMissingStrategy?, isModelInput?, isPolicyRuleInput?, ownerTeam? }`. |

`definitionBase` (campos comunes opcionales en cada entrada): `description`(max2000), `dataType`(2-40), `riskDimension`(2-60), `buildPhase`(2-40), `dataClassificationCode`(2-80), `requiresConsent`(bool), `isSensitive`(bool), `allowedForCreditDecision`(bool), `allowedForFraudDecision`(bool), `legalReviewStatus`(2-40), `fairnessReviewRequired`(bool), `retentionPolicyId`(string `^[1-9][0-9]*$`).

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| domain | string | Eco del dominio. |
| eventsProcessed | number | Cantidad de eventos procesados (upsert). |
| observationsProcessed | number | Cantidad de observaciones procesadas. |
| attributesProcessed | number | Cantidad de atributos procesados. |
| featuresProcessed | number | Cantidad de features procesadas. |

**Errores**
- Falta `x-idempotency-key` → `400 Bad Request`.
- Rol no interno/sistema → `403 Forbidden`.

---

### GET /api/v1/operations/risk-policy/current

**Propósito:** Obtener la política de riesgo vigente: versiones de modelo, versiones de ruleset (con sus reglas) y semillas de señales de riesgo.
**Auth:** JwtAuthGuard + RolesGuard + `assertInternal`.
**Headers:** `authorization`.

**Path params**
Ninguno.

**Query params**
Ninguno.

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| modelVersions | array | `{ riskModelVersionId, modelCode, versionCode, modelType, assessmentType, status, effectiveFrom, effectiveUntil }`. |
| rulesetVersions | array | `{ riskRulesetVersionId, rulesetCode, versionCode, assessmentType, status, effectiveFrom, effectiveUntil, rules }`. |
| rulesetVersions[].rules | array | `{ riskPolicyRuleId, ruleCode, ruleName, riskDimension, ruleType, severity, actionCode, reasonCode, isHardStop }`, filtradas por su `rulesetVersionId`. |
| riskSignalSeeds | array | `{ riskSignalSeedId, signalCode, signalName, signalType, sourceEntity, riskDimension, priority, expectedDirection, isActive }`. |

**Errores**
- Rol no interno/sistema → `403 Forbidden`.

---

### POST /api/v1/operations/risk-policy/ruleset-versions

**Propósito:** Crear una nueva versión de modelo de riesgo + ruleset asociado, con sus reglas y semillas de señales, en estado borrador/inactivo.
**Auth:** JwtAuthGuard + RolesGuard + `assertInternal`.
**Headers:** `authorization`; `x-tenant-id`; `x-idempotency-key` (**requerido**).

**Path params**
Ninguno.

**Query params**
Ninguno.

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| modelVersion.modelCode | string | Sí | regex código | Código del modelo. |
| modelVersion.versionCode | string | Sí | 2-80 | Código de versión del modelo. |
| modelVersion.modelType | string | No | 2-60, default `'rules'` | Tipo de modelo. |
| modelVersion.assessmentType | string | Sí | 2-80 | Tipo de evaluación. |
| modelVersion.status | enum | No | `draft`\|`inactive`, default `draft` | Estado inicial del modelo. |
| modelVersion.artifactUrl | string (url) | No | — | URL del artefacto del modelo. |
| modelVersion.artifactHash | string | No | max 128 | Hash del artefacto. |
| ruleset.rulesetCode | string | Sí | regex código | Código del ruleset. |
| ruleset.versionCode | string | Sí | 2-80 | Código de versión del ruleset. |
| ruleset.assessmentType | string | Sí | 2-80 | Tipo de evaluación. |
| ruleset.status | enum | No | `draft`\|`inactive`, default `draft` | Estado inicial. |
| rules | array | Sí | 1-500 | Reglas del ruleset. |
| rules[].ruleCode | string | Sí | regex código | Código de regla. |
| rules[].ruleName | string | Sí | 1-180 | Nombre. |
| rules[].riskDimension | string | Sí | 2-60 | Dimensión de riesgo. |
| rules[].ruleType | string | Sí | 2-60 | Tipo de regla. |
| rules[].severity | string | Sí | 2-40 | Severidad. |
| rules[].expressionJson | object | Sí | — | Expresión de la regla (JSON libre). |
| rules[].actionCode | string | Sí | 2-80 | Código de acción resultante. |
| rules[].reasonCode | string | Sí | 2-100 | Código de motivo. |
| rules[].isHardStop | boolean | No | default `false` | Si detiene el flujo. |
| riskSignalSeeds | array | No | max 500, default `[]` | Semillas de señales. |
| riskSignalSeeds[].signalCode | string | Sí | regex código | Código de señal. |
| riskSignalSeeds[].signalName | string | Sí | 1-180 | Nombre. |
| riskSignalSeeds[].signalType | string | Sí | 2-60 | Tipo. |
| riskSignalSeeds[].sourceEntity | string | Sí | 2-120 | Entidad fuente. |
| riskSignalSeeds[].targetDefinitionCode | string | No | regex código | Definición objetivo. |
| riskSignalSeeds[].riskDimension | string | No | 2-60 | Dimensión de riesgo. |
| riskSignalSeeds[].buildPhase | string | No | 2-40 | Fase de construcción. |
| riskSignalSeeds[].priority | string | No | 2-40 | Prioridad. |
| riskSignalSeeds[].expectedDirection | string | No | 2-40 | Dirección esperada de la señal. |
| riskSignalSeeds[].exampleValue | object | No | default `{}` | Valor de ejemplo. |
| riskSignalSeeds[].rationale | string | No | max 2000 | Justificación. |

**Response 201**
| Campo | Tipo | Descripción |
|---|---|---|
| riskModelVersionId | string | ID de la versión de modelo creada. |
| riskRulesetVersionId | string | ID de la versión de ruleset creada. |
| status | string | Estado del ruleset (`draft` o `inactive`, eco del body). |
| rulesCreated | number | Cantidad de reglas creadas. |
| riskSignalSeedsCreated | number | Cantidad de semillas de señal creadas. |

**Errores**
- Falta `x-idempotency-key` → `400 Bad Request`.
- Rol no interno/sistema → `403 Forbidden`.

---

### POST /api/v1/operations/risk-policy/ruleset-versions/:rulesetVersionId/activate

**Propósito:** Activar una versión de ruleset de riesgo, retirando automáticamente cualquier otra versión activa del mismo `rulesetCode`.
**Auth:** JwtAuthGuard + RolesGuard + `assertInternal`.
**Headers:** `authorization`; `x-tenant-id`; `x-idempotency-key` (**requerido**).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| rulesetVersionId | string `^[1-9][0-9]*$` | ID de la versión de ruleset a activar. |

**Query params**
Ninguno.

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| activationReason | string | Sí | 5-3000 | Motivo de la activación. |
| effectiveFrom | string (ISO datetime) | No | — | Fecha efectiva; default `now()` si se omite. |

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| riskRulesetVersionId | string | ID de la versión activada. |
| status | string | Nuevo estado (activo). |
| effectiveFrom | string/Date | Fecha efectiva de activación. |
| retiredPreviousActiveRulesets | number | Cantidad de versiones previas del mismo `rulesetCode` que se retiraron automáticamente. |

**Errores**
- Falta `x-idempotency-key` → `400 Bad Request`.
- Versión no encontrada → `404 Not Found` ("Versión de reglas no encontrada.").
- Estado actual no es `draft`/`inactive`/`approved` → `422 Unprocessable Entity` (`RULESET_VERSION_NOT_ACTIVATABLE`).

---

### GET /api/v1/operations/data-governance/policies

**Propósito:** Obtener el paquete completo de políticas de gobierno de datos vigentes: propósitos de privacidad, políticas de retención, proveedores de datos, políticas de clasificación, reglas de campos sensibles y reglas de calidad de datos.
**Auth:** JwtAuthGuard + RolesGuard + `assertInternal`.
**Headers:** `authorization`.

**Path params**
Ninguno.

**Query params**
Ninguno.

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| privacyPurposes | array | `{ purposeId, purposeCode, purposeName, legalBasis, requiresExplicitConsent }`. |
| retentionPolicies | array | `{ retentionPolicyId, policyCode, appliesTo, retentionDays, postRetentionAction, legalBasis }`. |
| dataProviders | array | `{ dataProviderId, providerCode, providerName, providerType, reliabilityScore, supportsRetroData }`. |
| classificationPolicies | array | `{ classificationPolicyId, classificationCode, classificationName, sensitivityLevel, defaultStorageMode, encryptionRequired, hashingRequired, rawStorageAllowed }`. |
| sensitiveFieldRules | array | `{ sensitiveFieldRuleId, tableName, fieldName, classificationCode, storageMode, searchStrategy, maskingStrategy, accessPolicyCode }`. |
| dataQualityRules | array | `{ dataQualityRuleId, ruleCode, ruleName, targetTable, targetField, severity, expectedAction, isActive }`. |

**Errores**
- Rol no interno/sistema → `403 Forbidden`.

---

### POST /api/v1/operations/data-governance/policy-package

**Propósito:** Dar de alta/actualizar (upsert) en lote el paquete de políticas de gobierno de datos.
**Auth:** JwtAuthGuard + RolesGuard + `assertInternal`.
**Headers:** `authorization`; `x-tenant-id`; `x-idempotency-key` (**requerido**).

**Path params**
Ninguno.

**Query params**
Ninguno.

**Request body**
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| privacyPurposes | array | No | max 200, default `[]` | `{ purposeCode(código), purposeName(1-180), legalBasis?(2-160), description?(max2000), requiresExplicitConsent?(bool, default false) }`. |
| retentionPolicies | array | No | max 200, default `[]` | `{ policyCode(código), appliesTo(2-80), retentionDays(int positivo), postRetentionAction(2-40), legalBasis?(2-180), description?(max2000) }`. |
| dataProviders | array | No | max 200, default `[]` | `{ providerCode(código), providerName(1-180), providerType(2-60), reliabilityScore?(decimal), supportsRetroData?(bool, default false), defaultRetentionPolicyId?(id) }`. |
| classificationPolicies | array | No | max 200, default `[]` | `{ classificationCode(código), classificationName(1-160), sensitivityLevel(2-40), allowedStorageModes?(object, default `{}`), defaultStorageMode?(2-40), defaultRetentionPolicyId?(id), encryptionRequired?(bool,false), hashingRequired?(bool,false), rawStorageAllowed?(bool,false), description?(max2000) }`. |
| sensitiveFieldRules | array | No | max 500, default `[]` | `{ tableName(2-120), fieldName(2-120), classificationCode(código), storageMode(2-40), searchStrategy?(2-40), maskingStrategy?(2-40), accessPolicyCode?(código), retentionPolicyId?(id) }`. |
| dataQualityRules | array | No | max 500, default `[]` | `{ ruleCode(código), ruleName(1-180), targetTable(2-120), targetField?(2-120), severity(2-40), expressionJson(object), expectedAction(2-80), buildPhase?(2-40) }`. |

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| privacyPurposesProcessed | number | Cantidad procesada. |
| retentionPoliciesProcessed | number | Cantidad procesada. |
| dataProvidersProcessed | number | Cantidad procesada. |
| classificationPoliciesProcessed | number | Cantidad procesada. |
| sensitiveFieldRulesProcessed | number | Cantidad procesada. |
| dataQualityRulesProcessed | number | Cantidad procesada. |

**Errores**
- Falta `x-idempotency-key` → `400 Bad Request`.
- Rol no interno/sistema → `403 Forbidden`.

---

<a id="modulo-05"></a>

# Systems Ops — Contrato HTTP completo

Prefijo global: `/api/v1` (env `API_PREFIX`, default `api/v1`).
Todos los controladores de este documento declaran `@Controller('systems')`, por lo que toda ruta cuelga de `/api/v1/systems/...`.

**Seguridad común a todos los endpoints de este documento**: los 5 controladores aplican la clase de decoradores `SystemsOpsControllerSecurity()` (`src/modules/systems-ops/systems-controller.decorators.ts`) a nivel de clase:

```ts
UseGuards(JwtAuthGuard, RolesGuard)
Roles('system_admin', 'platform_admin', 'admin', 'qa_engineer', 'devops', 'risk_analyst', 'compliance_analyst', 'readonly_auditor')
```

Ningún endpoint tiene `@Public()`. Ninguno redefine guards/roles a nivel de método, así que la fila **Auth** es idéntica para los 39 endpoints documentados: JWT válido (`JwtAuthGuard`) + rol dentro de la lista anterior (`RolesGuard`, lanza `403 ForbiddenException` con mensaje `"El usuario autenticado no tiene permiso para esta operación."` si el rol no matchea).

**Headers**: solo se exige `Authorization: Bearer <JWT>` (consumido por `JwtAuthGuard`). Ningún DTO/schema de este módulo referencia `x-tenant-id` ni `x-idempotency-key` explícitamente; no se documentan salvo que se indique lo contrario en un endpoint puntual.

**Validación de entrada**: todos los query/path/body que pasan por `ZodValidationPipe` devuelven, en caso de fallo, `400 BadRequestException` con forma:
```json
{ "message": "Entrada inválida en <query|param|body>.", "issues": [{ "path": "campo", "message": "..." }] }
```
Esta regla aplica a todo endpoint que use `new ZodValidationPipe(...)` — no se repite en cada bloque salvo aclaración.

**Status code por defecto de Nest** (no hay `@HttpCode` explícito en ningún método de estos controladores): `GET` → 200, `PATCH` → 200, `POST` → 201.

---

## Módulo: SystemsActionLogController

Archivo: `src/modules/systems-ops/systems-action-log.controller.ts`. Servicio: `SystemsActionLogQueryService`. Repositorio: `SystemsActionLogRepository`. Mapper: `mapActionLog`.

### GET /api/v1/systems/action-logs

**Propósito:** Listar el log de auditoría HTTP (System Action Logs) con filtros y paginación.
**Auth:** JwtAuthGuard + RolesGuard, roles `system_admin, platform_admin, admin, qa_engineer, devops, risk_analyst, compliance_analyst, readonly_auditor`.
**Headers:** Authorization Bearer JWT (ninguno especial adicional).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| (ninguno) | — | — |

**Query params** (`systemsActionLogQuerySchema`)
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| endpointId | string (regex `^[1-9][0-9]*$`) | No | — | Filtra por id de endpoint del catálogo |
| requestId | string (1-120) | No | — | Filtra por requestId exacto |
| correlationId | string (1-120) | No | — | Filtra por correlationId |
| method | enum `GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD` | No | — | Filtra por método HTTP |
| statusCode | number (100-599, coercionado) | No | — | Filtra por status code de respuesta |
| actorType | string (1-80) | No | — | Filtra por tipo de actor |
| module | string (1-120) | No | — | Filtra por módulo |
| riskLevel | enum `LOW,MEDIUM,HIGH,CRITICAL` | No | — | Filtra por nivel de riesgo |
| containsPii | boolean (coercionado) | No | — | Filtra logs que contienen PII |
| from | string ISO datetime | No | — | Rango de fecha desde |
| to | string ISO datetime | No | — | Rango de fecha hasta |
| page | number entero positivo (coercionado) | No | 1 | Página |
| limit | number entero positivo max 100 (coercionado) | No | 20 | Tamaño de página |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| items | ActionLog[] | Lista de logs (ver forma abajo) |
| meta.page | number | Página actual |
| meta.limit | number | Tamaño de página |
| meta.total | number | Total de filas que matchean el filtro |
| meta.totalPages | number | `ceil(total/limit)` |

Forma de cada `ActionLog` (`mapActionLog`):
| Campo | Tipo | Descripción |
|---|---|---|
| actionLogId | string | Id (convertido a string) |
| requestId | string | Id de request |
| correlationId | string \| null | Id de correlación |
| endpointCatalogId | string \| null | Id del endpoint en catálogo (si se resolvió) |
| actorUserId | string \| null | Usuario actor |
| actorType | string | Tipo de actor |
| actorRole | string \| null | Rol del actor |
| method | string | Método HTTP |
| routeTemplate | string | Plantilla de ruta (`/algo/:id`) |
| resolvedUrlSanitized | string | URL resuelta, sanitizada |
| module | string | Módulo |
| actionName | string | Nombre de acción |
| ipAddress | string \| null | IP de origen |
| targetType | string \| null | Tipo de entidad objetivo |
| targetId | string \| null | Id de entidad objetivo |
| customerId | string \| null | Id de cliente relacionado |
| responseStatusCode | number | Status HTTP de respuesta |
| durationMs | number | Duración de la request |
| riskLevel | string | Nivel de riesgo |
| containsPii | boolean | Si contiene PII |
| occurredAt | string (ISO) \| null | Timestamp del evento |

**Errores**
- Query inválida (tipo/enum/rango) → `400 BadRequestException` (ZodValidationPipe).

---

### GET /api/v1/systems/action-logs/request/:requestId

**Propósito:** Alias de compatibilidad para obtener todos los logs asociados a un `requestId`.
**Auth:** igual que arriba.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| requestId | string (1-120) | Identificador de request a buscar |

**Query params**
Ninguno.

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| items | ActionLog[] | Logs asociados al requestId, orden `occurredAt DESC` (misma forma que arriba, sin `meta`) |

**Errores**
- `requestId` vacío o >120 caracteres → `400 BadRequestException`.
- No existe ningún log con ese `requestId` → no lanza error; devuelve `{ items: [] }`.

---

### GET /api/v1/systems/action-logs/by-request/:requestId

**Propósito:** Idéntico al anterior (mismo handler de servicio `getActionLogsByRequest`); ruta canónica no-alias.
**Auth:** igual que arriba.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| requestId | string (1-120) | Identificador de request a buscar |

**Query params**
Ninguno.

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| items | ActionLog[] | Igual forma que el alias anterior |

**Errores**
- `requestId` inválido → `400 BadRequestException`.

---

## Módulo: SystemsCatalogController

Archivo: `src/modules/systems-ops/systems-catalog.controller.ts`. Servicios: `SystemsCatalogQueryService`, `SystemsToolInferenceService`. Repositorios: `SystemsCatalogRepository`, `SystemsDashboardRepository`. Mappers: `mapEndpoint`, `mapTool`, `mapDataEntity`, `mapToolRequirement`, `mapDataImpact`, `mapFieldImpact`.

### GET /api/v1/systems/dashboard

**Propósito:** Vista resumida del estado del catálogo de sistemas (conteos + postura de gobierno de datos) para el panel de operaciones.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
Ninguno.

**Query params**
Ninguno.

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| counts.endpoints | number | Total de endpoints catalogados |
| counts.tools | number | Total de herramientas |
| counts.dataEntities | number | Total de entidades de datos |
| counts.testSuites | number | Total de suites de prueba |
| counts.pendingReviews | number | Suma de pendientes `NEEDS_REVIEW` en endpoints, entidades, impactos de datos, impactos de campo y requisitos de herramientas |
| counts.stressProfiles | number | Perfiles de stress con `isEnabled=true` |
| counts.actionLogs24h | number | Logs de acción de las últimas 24h |
| posture.catalogCoverage | `'READY_FOR_REVIEW' \| 'NEEDS_SEED_REFRESH'` | `READY_FOR_REVIEW` si hay endpoints y entidades > 0 |
| posture.pendingReviews | number | Igual a `counts.pendingReviews` |
| posture.stressProfilesEnabled | number | Igual a `counts.stressProfiles` |

**Errores**
- Ninguno específico (solo errores genéricos de infraestructura no capturados).

---

### GET /api/v1/systems/endpoints

**Propósito:** Listar endpoints del catálogo de sistemas con filtros de módulo, estado, riesgo y búsqueda.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
Ninguno.

**Query params** (`systemsListQuerySchema`, reutilizado por muchos endpoints de listado en este módulo)
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| module | string (1-120) | No | — | Filtra por módulo |
| status | string (1-40) | No | — | Filtra por estado (`ACTIVE`, `DEPRECATED_CANDIDATE`, ...) |
| riskLevel | enum `LOW,MEDIUM,HIGH,CRITICAL` | No | — | Filtra por riesgo |
| reviewStatus | enum `AUTO_DETECTED,NEEDS_REVIEW,APPROVED,REJECTED` | No | — | Filtra por estado de revisión |
| q | string (1-200) | No | — | Búsqueda de texto libre |
| page | number entero positivo | No | 1 | Página |
| limit | number entero positivo max 100 | No | 20 | Tamaño de página |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| items | Endpoint[] | Ver forma `Endpoint` abajo |
| meta | `{page, limit, total, totalPages}` | Paginación |

Forma de `Endpoint` (`mapEndpoint`):
| Campo | Tipo | Descripción |
|---|---|---|
| endpointId | string | Id |
| code | string | Código único del endpoint |
| module | string | Módulo |
| controllerName | string \| null | Nombre de la clase controller |
| handlerName | string \| null | Nombre del método handler |
| method | string | Método HTTP |
| routePath | string | Ruta relativa (sin `/api/v1`) |
| fullPath | string | Ruta completa con prefijo |
| routeName | string | Nombre lógico de la ruta |
| businessPurpose | string | Propósito de negocio |
| businessAction | string \| null | Acción de negocio |
| expectedResponseSummary | string \| null | Resumen esperado de respuesta |
| expectedStatusCodes | number[] | Status codes esperados |
| minPayloadSchema | object | Esquema mínimo de payload |
| queryParamsSchema | object | Esquema de query params |
| pathParamsSchema | object | Esquema de path params |
| headersSchema | object | Esquema de headers |
| requiresAuth | boolean | Si requiere auth |
| allowedRoles | string[] | Roles permitidos documentados |
| containsPii | boolean | Si maneja PII |
| piiFields | string[] | Campos PII |
| riskLevel | string | Nivel de riesgo |
| isDestructive | boolean | Si es destructivo (`DELETE`) |
| isReadonly | boolean | Si es de solo lectura |
| idempotencyRequired | boolean | Si requiere idempotencia |
| requiresStressTest | boolean | Si requiere prueba de stress |
| requiresIntegrationTest | boolean | Si requiere prueba de integración |
| isTestableFromPortal | boolean | Si es probable desde el portal |
| testEnvironmentOnly | boolean | Si solo aplica a ambientes de prueba |
| ownerTeam | string \| null | Equipo dueño |
| status | string | Estado (`ACTIVE`, `DEPRECATED_CANDIDATE`, ...) |
| version | string | Versión (`v1`) |
| detectedFrom | string | Origen de detección (`controller`, `manual_seed`, ...) |
| confidenceLevel | string | Confianza de la clasificación |
| reviewStatus | string | Estado de revisión |
| sourceFile | string \| null | Archivo fuente relativo |
| createdAt | string (ISO) \| null | Fecha de creación |
| updatedAt | string (ISO) \| null | Fecha de actualización |

**Errores**
- Query inválida → `400 BadRequestException`.

---

### GET /api/v1/systems/endpoints/:endpointId

**Propósito:** Obtener el detalle completo de un endpoint del catálogo, incluyendo herramientas, impactos de datos e impactos de campo asociados.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| endpointId | string (regex `^[1-9][0-9]*$`) | Id numérico del endpoint |

**Query params**
Ninguno.

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| endpoint | Endpoint | Ver forma arriba |
| toolRequirements | ToolRequirement[] | Ver forma `ToolRequirement` abajo |
| dataEntityImpacts | DataImpact[] | Ver forma `DataImpact` abajo |
| fieldImpacts | FieldImpact[] | Ver forma `FieldImpact` abajo |

Forma `ToolRequirement` (`mapToolRequirement`): `requirementId, endpointId, toolId, usageType, isRequired, failureImpact, fallbackStrategy, requiresMock, requiresStressTest, notes, detectedFrom, confidenceLevel, reviewStatus` (todos string/boolean según nombre, ids como string).

Forma `DataImpact` (`mapDataImpact`): `impactId, endpointId, dataEntityId, operationType, impactLevel, isPrimaryEntity, isTransactional, rollbackRequired, affectsCustomerState, affectsFinancialState, affectsRiskState, affectsLegalState, affectsDeviceState, affectsNotificationState, requiresAuditLog, requiresRegressionTest, requiresStressTest, notes, detectedFrom, confidenceLevel, reviewStatus`.

Forma `FieldImpact` (`mapFieldImpact`): `fieldImpactId, endpointId, dataEntityId, fieldName, fieldOperation, isRequiredInput, isGenerated, isSensitive, isMlCandidate, mlFeatureGroup, validationRule, notes, confidenceLevel, reviewStatus`.

**Errores**
- `endpointId` no existe → `404 NotFoundException('SYSTEM_ENDPOINT_NOT_FOUND')`.
- `endpointId` no matchea el regex (no es entero positivo) → `400 BadRequestException`.

---

### POST /api/v1/systems/endpoints/discover

**Propósito:** Escanear el código fuente de todos los controllers (`src/modules/**/*.controller.ts`) para detectar endpoints automáticamente y opcionalmente persistirlos en el catálogo.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
Ninguno.

**Query params**
Ninguno.

**Request body** (`discoverEndpointsSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| mode | enum `SOURCE_SCAN` | No | default `SOURCE_SCAN` | Modo de descubrimiento (único valor soportado hoy) |
| persist | boolean (coercionado) | No | default `true` | Si `true`, hace upsert de cada endpoint detectado y marca como `DEPRECATED_CANDIDATE` los que dejaron de existir |

**Response 201**
| Campo | Tipo | Descripción |
|---|---|---|
| discovered | number | Cantidad de endpoints detectados en el escaneo |
| persisted | number | Cantidad efectivamente escrita en DB (0 si `persist=false`) |
| deprecatedCandidates | number | Endpoints marcados `DEPRECATED_CANDIDATE` por no aparecer más en el escaneo (0 si `persist=false`) |
| items | DiscoveredEndpoint[] | Detalle de cada endpoint detectado (superset de `EndpointSeed` + `controllerName`, `handlerName`) |

**Errores**
- Body inválido (`mode` fuera de enum) → `400 BadRequestException`.
- Ninguna excepción de negocio explícita; si `src/modules` no existe, devuelve `discovered: 0`.

---

### POST /api/v1/systems/endpoints/catalog-seed/refresh

**Propósito:** Re-sembrar el catálogo completo (herramientas, entidades de datos, endpoints curados + descubiertos, impactos, suites de prueba y perfiles de stress) desde los fixtures/seeds del backend.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
Ninguno.

**Query params**
Ninguno.

**Request body** (`catalogSeedRefreshSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| includeTools | boolean (coercionado) | No | default `true` | Si sembrar/actualizar `SYSTEM_TOOL_SEEDS` |
| includeDataEntities | boolean (coercionado) | No | default `true` | Si sembrar entidades de datos desde los modelos Sequelize (`src/database/models/*.model.ts`) |
| includeEndpointSeeds | boolean (coercionado) | No | default `true` | Si sembrar endpoints curados, correr el discovery, sembrar impactos desde `docs/endpoints/endpoints.md`, suites y perfiles de stress |

**Response 201**
| Campo | Tipo | Descripción |
|---|---|---|
| tools | number | Herramientas sembradas (0 si `includeTools=false`) |
| dataEntities | number | Entidades de datos sembradas |
| endpointSeeds | number | Endpoints curados sembrados |
| discoveredEndpoints | number | Endpoints detectados y persistidos por el discovery interno |
| impacts | number | Impactos de datos sembrados desde `docs/endpoints/endpoints.md` |
| suites | number | Suites de prueba sembradas (fijo 2 si se ejecuta el paso) |
| stressProfiles | number | Perfiles de stress sembrados |

**Errores**
- Body inválido → `400 BadRequestException`.
- Ninguna excepción de negocio explícita (best-effort; entradas sin match simplemente se saltan).

---

### GET /api/v1/systems/tools

**Propósito:** Listar herramientas/dependencias técnicas catalogadas (DB, cache, colas, proveedores externos, etc.).
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
Ninguno.

**Query params**: `systemsListQuerySchema` (igual tabla que en `GET /endpoints`).

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| items | Tool[] | Ver forma abajo |
| meta | `{page, limit, total, totalPages}` | Paginación |

Forma `Tool` (`mapTool`): `toolId, code, name, type, provider, purpose, requiredEnvVars (string[]), hasSandbox (boolean), healthcheckRoute (string\|null), requiresCredentials (boolean), isCritical (boolean), status (string), ownerTeam (string\|null)`.

**Errores**
- Query inválida → `400 BadRequestException`.

---

### GET /api/v1/systems/tools/:toolId

**Propósito:** Obtener el detalle de una herramienta catalogada.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| toolId | string (regex `^[1-9][0-9]*$`) | Id numérico de la herramienta |

**Query params**
Ninguno.

**Request body**
Sin body.

**Response 200**: objeto `Tool` (ver forma arriba).

**Errores**
- No existe → `404 NotFoundException('SYSTEM_TOOL_NOT_FOUND')`.
- `toolId` inválido → `400 BadRequestException`.

---

### POST /api/v1/systems/tools/infer-requirements

**Propósito:** Analizar el código fuente de cada endpoint activo y, mediante patrones regex sobre nombres de herramientas conocidas (JWT, ZOD, POSTGRES, SEQUELIZE, REDIS, OUTBOX_EVENTS_DB, IDEMPOTENCY_KEYS_DB, OPERATIONAL_AUDIT_LOGS, SYSTEM_ACTION_LOGS, S3_OR_OBJECT_STORAGE, WHATSAPP_GENERIC, INFOCENTER), inferir qué herramientas usa cada endpoint y opcionalmente persistir el requisito.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
Ninguno.

**Query params**
Ninguno.

**Request body** (`inferToolRequirementsSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| persist | boolean (coercionado) | No | default `true` | Si `true`, hace upsert de cada requisito de herramienta detectado con `reviewStatus=NEEDS_REVIEW` |

**Response 201**
| Campo | Tipo | Descripción |
|---|---|---|
| inferred | number | Total de inferencias detectadas |
| persisted | number | Cantidad persistida (0 si `persist=false`) |
| skippedMissingTools | number | Inferencias saltadas porque la herramienta referenciada no existe en catálogo |
| reviewStatus | `'NEEDS_REVIEW' \| 'DRY_RUN'` | `NEEDS_REVIEW` si `persist=true`, `DRY_RUN` si no |
| items | ToolInference[] (máx 500) | `{endpointId, endpointCode, toolCode, usageType, confidenceLevel, notes}` |

**Errores**
- Body inválido → `400 BadRequestException`.

---

### GET /api/v1/systems/data-entities

**Propósito:** Listar entidades de datos (tablas) catalogadas con su clasificación de sensibilidad.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
Ninguno.

**Query params**: `systemsListQuerySchema` (igual tabla anterior).

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| items | DataEntity[] | Ver forma abajo |
| meta | `{page, limit, total, totalPages}` | Paginación |

Forma `DataEntity` (`mapDataEntity`): `entityId, schemaName, tableName, modelName, entityName, module, businessPurpose, dataOwner, containsPii, containsFinancialData, containsRiskData, containsLegalData, containsDeviceData, containsLocationData, isAuditCritical, retentionPolicyCode, status, detectedFrom, confidenceLevel, reviewStatus`.

**Errores**
- Query inválida → `400 BadRequestException`.

---

### GET /api/v1/systems/data-entities/:entityId

**Propósito:** Obtener el detalle de una entidad de datos.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| entityId | string (regex `^[1-9][0-9]*$`) | Id numérico de la entidad |

**Query params**
Ninguno.

**Request body**
Sin body.

**Response 200**: objeto `DataEntity` (ver forma arriba).

**Errores**
- No existe → `404 NotFoundException('SYSTEM_DATA_ENTITY_NOT_FOUND')`.
- `entityId` inválido → `400 BadRequestException`.

---

### PATCH /api/v1/systems/data-entities/:entityId/metadata

**Propósito:** Actualizar metadatos de gobierno de una entidad de datos (owner, sensibilidad, retención, estado, revisión).
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| entityId | string (regex `^[1-9][0-9]*$`) | Id numérico de la entidad |

**Query params**
Ninguno.

**Request body**
**IMPORTANTE:** este endpoint **no usa Zod** — el body se recibe con `@Body()` plano (`Record<string, unknown>`), sin validación de forma/tipos en el pipe. El repositorio (`updateDataEntityMetadata`) solo aplica los campos que están en esta whitelist; cualquier otro campo enviado es ignorado silenciosamente:

| Campo | Tipo esperado | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| businessPurpose | string | No | sin validar | Propósito de negocio |
| dataOwner | string | No | sin validar | Equipo/persona dueña del dato |
| containsPii | boolean | No | sin validar | Marca de PII |
| containsFinancialData | boolean | No | sin validar | Marca de dato financiero |
| containsRiskData | boolean | No | sin validar | Marca de dato de riesgo |
| containsLegalData | boolean | No | sin validar | Marca de dato legal |
| containsDeviceData | boolean | No | sin validar | Marca de dato de dispositivo |
| containsLocationData | boolean | No | sin validar | Marca de dato de ubicación |
| isAuditCritical | boolean | No | sin validar | Si es crítico para auditoría |
| retentionPolicyCode | string | No | sin validar | Código de política de retención |
| status | string | No | sin validar | Estado de la entidad |
| reviewStatus | string | No | sin validar | Estado de revisión |

**Response 200**: objeto `DataEntity` actualizado (ver forma arriba).

**Errores**
- `entityId` no existe → `404 NotFoundException('SYSTEM_DATA_ENTITY_NOT_FOUND')`.
- `entityId` inválido (path) → `400 BadRequestException`.
- Nota de seguridad para frontend: al no haber Zod en el body, tampoco hay control de tipos en runtime más allá de lo que Sequelize acepte al guardar (puede fallar con error 500 no controlado si se envían tipos incompatibles).

---

### GET /api/v1/systems/impact/by-endpoint/:endpointId

**Propósito:** Ver, desde la perspectiva de un endpoint, qué herramientas usa y qué tablas/campos impacta.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| endpointId | string (regex `^[1-9][0-9]*$`) | Id numérico del endpoint |

**Query params**
Ninguno.

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| endpoint | Endpoint | Ver forma arriba |
| tools | ToolRequirement[] | Herramientas requeridas por el endpoint |
| tables | DataImpact[] | Entidades de datos impactadas |
| fields | FieldImpact[] | Campos impactados |

**Errores**
- No existe → `404 NotFoundException('SYSTEM_ENDPOINT_NOT_FOUND')`.
- `endpointId` inválido → `400 BadRequestException`.

---

### GET /api/v1/systems/impact/by-table/:schemaName/:tableName

**Propósito:** Ver, desde la perspectiva de una tabla, qué endpoints la impactan.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| schemaName | string (1-120) | Nombre del esquema de BD (p. ej. `public`) |
| tableName | string (1-180) | Nombre de la tabla |

**Query params**
Ninguno.

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| entity | DataEntity | Entidad de datos correspondiente a la tabla |
| endpointImpacts | DataImpact[] | Impactos de endpoints sobre esa entidad |

**Errores**
- No existe entidad para `schemaName`+`tableName` → `404 NotFoundException('SYSTEM_DATA_ENTITY_NOT_FOUND')`.
- Params inválidos (vacíos o fuera de longitud) → `400 BadRequestException`.

---

### GET /api/v1/systems/health/tools

**Propósito:** Ver el estado de salud/configuración (env vars presentes) de cada herramienta catalogada (máx. 100).
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
Ninguno.

**Query params**
Ninguno.

**Request body**
Sin body.

**Response 200**: array directo (sin envolver en `items`/`meta`) de:
| Campo | Tipo | Descripción |
|---|---|---|
| code | string | Código de la herramienta |
| name | string | Nombre |
| status | string | Estado catalogado |
| isConfigured | boolean | `true` si todas sus `requiredEnvVars` están presentes en `process.env` |
| missingEnvVars | string[] | Variables de entorno faltantes |
| isCritical | boolean | Si es crítica |

**Errores**
- Ninguno específico.

---

## Módulo: SystemsReviewController

Archivo: `src/modules/systems-ops/systems-review.controller.ts`. Servicio: `SystemsReviewService`. Repositorio: `SystemsReviewRepository`.

### GET /api/v1/systems/review-queue

**Propósito:** Cola unificada de elementos del catálogo pendientes de revisión (endpoints, entidades de datos, impactos de datos, impactos de campo, requisitos de herramientas).
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
Ninguno.

**Query params** (`systemsReviewQueueSchema`)
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| type | enum `all,endpoints,data_entities,data_impacts,field_impacts,tool_requirements` | No | `all` | Qué colección(es) incluir |
| module | string (1-120) | No | — | Filtra por módulo (solo aplica a endpoints/entidades, vía `buildReviewWhere`) |
| reviewStatus | enum `AUTO_DETECTED,NEEDS_REVIEW,APPROVED,REJECTED` | No | `NEEDS_REVIEW` | Estado de revisión a filtrar en todas las colecciones |
| page | number entero positivo | No | 1 | Página (misma paginación aplicada a las 5 colecciones) |
| limit | number entero positivo max 100 | No | 20 | Tamaño de página |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| endpoints.items | Endpoint[] | Vacío si `type` excluye `endpoints` |
| endpoints.total | number | Conteo total (0 si excluido) |
| dataEntities.items | DataEntity[] | Vacío si `type` excluye `data_entities` |
| dataEntities.total | number | Conteo total |
| dataEntityImpacts.items | DataImpact[] | Vacío si `type` excluye `data_impacts` |
| dataEntityImpacts.total | number | Conteo total |
| fieldImpacts.items | FieldImpact[] | Vacío si `type` excluye `field_impacts` |
| fieldImpacts.total | number | Conteo total |
| toolRequirements.items | ToolRequirement[] | Vacío si `type` excluye `tool_requirements` |
| toolRequirements.total | number | Conteo total |

Nota: esta respuesta usa `{items, total}` por colección (sin `page/limit/totalPages`), distinto del envelope `{items, meta}` usado en el resto del módulo.

**Errores**
- Query inválida → `400 BadRequestException`.

---

### PATCH /api/v1/systems/endpoints/:endpointId/review

**Propósito:** Aprobar, rechazar o marcar para revisión un endpoint del catálogo.
**Auth:** igual que módulo. Usa `@CurrentUser()` para registrar `updatedBy`.
**Headers:** ninguno especial (requiere JWT válido para poblar `CurrentUser`).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| endpointId | string (regex `^[1-9][0-9]*$`) | Id numérico del endpoint |

**Query params**
Ninguno.

**Request body** (`reviewDecisionSchema`, compartido por los 5 endpoints `*/review` de este controlador)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| reviewStatus | enum `NEEDS_REVIEW,APPROVED,REJECTED` | Sí | — | Nueva decisión de revisión |
| confidenceLevel | enum `LOW,MEDIUM,HIGH` | No | — | Nivel de confianza asociado a la decisión |
| notes | string (max 1000) | No | — | Notas del revisor (no se persiste en endpoints, solo en data_impact/field_impact/tool_requirement) |

**Response 200**: objeto `Endpoint` actualizado (ver forma en el módulo catálogo).

**Errores**
- No existe → `404 NotFoundException('SYSTEM_ENDPOINT_NOT_FOUND')`.
- Body inválido (`reviewStatus` fuera de enum) → `400 BadRequestException`.

---

### PATCH /api/v1/systems/tools/requirements/:requirementId/review

**Propósito:** Revisar un requisito de herramienta inferido/manual para un endpoint.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| requirementId | string (regex `^[1-9][0-9]*$`) | Id numérico del requisito de herramienta |

**Query params**
Ninguno.

**Request body**: `reviewDecisionSchema` (ver tabla arriba).

**Response 200**: objeto `ToolRequirement` actualizado (ver forma en el módulo catálogo).

**Errores**
- No existe → `404 NotFoundException('SYSTEM_TOOL_REQUIREMENT_NOT_FOUND')`.
- Body/path inválido → `400 BadRequestException`.

---

### PATCH /api/v1/systems/data-entities/:entityId/review

**Propósito:** Revisar (aprobar/rechazar) una entidad de datos del catálogo.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| entityId | string (regex `^[1-9][0-9]*$`) | Id numérico de la entidad |

**Query params**
Ninguno.

**Request body**: `reviewDecisionSchema` (ver tabla arriba).

**Response 200**: objeto `DataEntity` actualizado.

**Errores**
- No existe → `404 NotFoundException('SYSTEM_DATA_ENTITY_NOT_FOUND')`.
- Body/path inválido → `400 BadRequestException`.

---

### PATCH /api/v1/systems/impact/data/:impactId/review

**Propósito:** Revisar un impacto de endpoint sobre entidad de datos.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| impactId | string (regex `^[1-9][0-9]*$`) | Id numérico del impacto de datos |

**Query params**
Ninguno.

**Request body**: `reviewDecisionSchema` (ver tabla arriba; `notes` sí se persiste aquí si viene definido).

**Response 200**: objeto `DataImpact` actualizado.

**Errores**
- No existe → `404 NotFoundException('SYSTEM_DATA_IMPACT_NOT_FOUND')`.
- Body/path inválido → `400 BadRequestException`.

---

### PATCH /api/v1/systems/impact/fields/:fieldImpactId/review

**Propósito:** Revisar un impacto de endpoint sobre un campo específico.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| fieldImpactId | string (regex `^[1-9][0-9]*$`) | Id numérico del impacto de campo |

**Query params**
Ninguno.

**Request body**: `reviewDecisionSchema` (ver tabla arriba; `notes` sí se persiste aquí si viene definido).

**Response 200**: objeto `FieldImpact` actualizado.

**Errores**
- No existe → `404 NotFoundException('SYSTEM_FIELD_IMPACT_NOT_FOUND')`.
- Body/path inválido → `400 BadRequestException`.

---

## Módulo: SystemsStressController

Archivo: `src/modules/systems-ops/systems-stress.controller.ts`. Servicios: `SystemsStressProfileService`, `SystemsStressRunService`. Repositorios: `SystemsStressProfileRepository`, modelo `SystemJobRunModel`. Mapper: `mapStressProfile`.

### GET /api/v1/systems/stress-profiles

**Propósito:** Listar perfiles de prueba de stress configurados por endpoint.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
Ninguno.

**Query params** (`systemsStressProfileQuerySchema`)
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| endpointId | string (regex `^[1-9][0-9]*$`) | No | — | Filtra por endpoint |
| status | string (1-40) | No | — | Filtra por estado (`ACTIVE, DISABLED, NEEDS_REVIEW, DEPRECATED`) |
| enabled | boolean (coercionado) | No | — | Filtra por `isEnabled` |
| q | string (1-200) | No | — | Búsqueda libre |
| page | number entero positivo | No | 1 | Página |
| limit | number entero positivo max 100 | No | 20 | Tamaño de página |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| items | StressProfile[] | Ver forma abajo |
| meta | `{page, limit, total, totalPages}` | Paginación |

Forma `StressProfile` (`mapStressProfile`): `profileId, endpointId, code, name, targetRps (number), durationSeconds (number), concurrency (number), environmentScope (string[]), maxErrorRate (number), maxP95Ms (number), isEnabled (boolean), requiresApproval (boolean), status (string), notes (string\|null), createdBy (string\|null), updatedBy (string\|null), createdAt (ISO\|null), updatedAt (ISO\|null)`.

**Errores**
- Query inválida → `400 BadRequestException`.

---

### GET /api/v1/systems/stress-profiles/:profileId

**Propósito:** Obtener el detalle de un perfil de stress.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| profileId | string (regex `^[1-9][0-9]*$`) | Id numérico del perfil |

**Query params**
Ninguno.

**Request body**
Sin body.

**Response 200**: objeto `StressProfile` (ver forma arriba).

**Errores**
- No existe → `404 NotFoundException('SYSTEM_STRESS_PROFILE_NOT_FOUND')`.
- `profileId` inválido → `400 BadRequestException`.

---

### POST /api/v1/systems/stress-profiles/:profileId/queue-run

**Propósito:** Encolar un job de ejecución de stress test para un perfil (fase actual solo encola el plan; la ejecución real la hace un worker externo).
**Auth:** igual que módulo. Usa `@CurrentUser()` como `triggeredById`.
**Headers:** ninguno especial (requiere JWT).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| profileId | string (regex `^[1-9][0-9]*$`) | Id numérico del perfil a ejecutar |

**Query params**
Ninguno.

**Request body** (`queueStressRunSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| environment | enum `LOCAL,STAGING,PRODUCTION_READONLY` | No | default `LOCAL` | Ambiente destino; debe estar en `environmentScope` del perfil |
| dryRun | boolean (coercionado) | No | default `true` | Si `false`, requiere `approvalTicket` cuando el perfil `requiresApproval` |
| baseUrl | string URL | No | — | URL base del ambiente objetivo |
| approvalTicket | string (3-160) | No | — | Ticket de aprobación (obligatorio si `dryRun=false` y `requiresApproval=true`) |
| config | object libre | No | default `{}` | Config adicional del run, se persiste en `inputJson.config` |
| headers | Record<string,string> | No | default `{}` | Headers a usar; los que matchean `/authorization|token|cookie|secret|key/i` se guardan como `[REDACTED]` |

**Response 201**
| Campo | Tipo | Descripción |
|---|---|---|
| queued | boolean | Siempre `true` si no lanzó error |
| run.jobRunId | string | Id del job creado (`SystemJobRunModel`) |
| run.jobCode | string | Siempre `systems_stress_run` |
| run.status | string | `queued` |
| run.startedAt | string (ISO) \| null | `null` al encolar |
| run.completedAt | string (ISO) \| null | `null` al encolar |
| run.inputJson | object | `{profileId, endpointId, profileCode, environment, dryRun, baseUrl, targetRps, durationSeconds, concurrency, maxErrorRate, maxP95Ms, approvalTicket, config, headers (sanitizados), note}` |
| run.resultJson | null | `null` al encolar |
| run.errorMessage | string \| null | `null` al encolar |
| run.triggeredByType | string | `'user'` |
| run.triggeredById | string \| null | Id del usuario actor |
| run.createdAt | string (ISO) \| null | Fecha de creación del job |

**Errores**
- Perfil no existe → `404 NotFoundException('SYSTEM_STRESS_PROFILE_NOT_FOUND')`.
- Perfil deshabilitado o `status != 'ACTIVE'` → `400 BadRequestException('SYSTEM_STRESS_PROFILE_NOT_ACTIVE')`.
- `environment` fuera del `environmentScope` del perfil → `400 BadRequestException('SYSTEM_STRESS_ENVIRONMENT_NOT_ALLOWED')`.
- `environment === 'PRODUCTION_READONLY'` → `400 BadRequestException('STRESS_RUNS_ARE_BLOCKED_IN_PRODUCTION')` (bloqueado siempre, incluso antes del check anterior si aplica).
- `dryRun=false`, perfil `requiresApproval=true` y sin `approvalTicket` → `400 BadRequestException('STRESS_RUN_REQUIRES_APPROVAL_TICKET')`.
- Body inválido (ej. `baseUrl` no es URL) → `400 BadRequestException` (Zod).

---

### POST /api/v1/systems/stress-profiles

**Propósito:** Crear o actualizar (upsert) un perfil de stress para un endpoint.
**Auth:** igual que módulo. Usa `@CurrentUser()` como `createdBy`/`updatedBy`.
**Headers:** ninguno especial.

**Path params**
Ninguno.

**Query params**
Ninguno.

**Request body** (`upsertStressProfileSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| endpointId | string (regex `^[1-9][0-9]*$`) | Sí | — | Endpoint al que aplica el perfil (debe existir) |
| code | string | No | 3-180 chars, regex `^[A-Z0-9_]+$` | Código del perfil; si se omite, se genera como `STRESS_<endpoint.code>` (máx 180) |
| name | string | Sí | 3-220 chars | Nombre del perfil |
| targetRps | number entero (coercionado) | Sí | 1-10000 | Requests por segundo objetivo |
| durationSeconds | number entero (coercionado) | Sí | 5-86400 | Duración de la prueba |
| concurrency | number entero (coercionado) | Sí | 1-5000 | Concurrencia |
| environmentScope | string[] enum `LOCAL,STAGING,PRODUCTION_READONLY` | No | 1-3 items | default `['LOCAL','STAGING']` |
| maxErrorRate | number (coercionado) | No | 0-1, default `0.01` | Tasa máxima de error tolerada |
| maxP95Ms | number entero (coercionado) | No | 1-300000, default `1000` | Latencia p95 máxima tolerada (ms) |
| isEnabled | boolean (coercionado) | No | default `true` | Si el perfil está habilitado |
| requiresApproval | boolean (coercionado) | No | default `true` | Si requiere ticket de aprobación para runs reales |
| status | enum `ACTIVE,DISABLED,NEEDS_REVIEW,DEPRECATED` | No | default `ACTIVE` | Estado del perfil |
| notes | string (max 2000) | No | — | Notas |

**Response 201**: objeto `StressProfile` (ver forma arriba, en `GET /stress-profiles`).

**Errores**
- `endpointId` no existe en catálogo → `404 NotFoundException('SYSTEM_ENDPOINT_NOT_FOUND')`.
- Body inválido (`targetRps`/`durationSeconds`/`concurrency` fuera de rango, `code` no matchea regex, etc.) → `400 BadRequestException`.

---

### GET /api/v1/systems/stress-matrix

**Propósito:** Ver, para cada endpoint que requiere prueba de stress (`requiresStressTest=true`), qué perfiles tiene configurados y si al menos uno está habilitado.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
Ninguno.

**Query params**: `systemsListQuerySchema` (misma tabla que `GET /endpoints`; se usa para filtrar los endpoints candidatos).

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| items[].endpoint | Endpoint | Endpoint que requiere stress test |
| items[].profiles | StressProfile[] | Perfiles configurados para ese endpoint |
| items[].hasEnabledProfile | boolean | `true` si al menos un perfil tiene `isEnabled=true` |
| meta | `{page, limit, total, totalPages}` | Paginación sobre los endpoints candidatos |

**Errores**
- Query inválida → `400 BadRequestException`.

---

### GET /api/v1/systems/stress-runs

**Propósito:** Listar los jobs de ejecución de stress encolados/ejecutados (`jobCode = systems_stress_run`).
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
Ninguno.

**Query params** (`systemsRunsQuerySchema`, compartido también por `GET /test-runs`)
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| suiteId | string (regex `^[1-9][0-9]*$`) | No | — | No aplica a stress runs (se usa solo en test-runs; aquí queda sin efecto porque el filtro solo usa `status`) |
| status | enum `QUEUED,RUNNING,PASSED,FAILED,CANCELLED` | No | — | Se compara en minúscula contra `SystemJobRunModel.status` |
| environment | enum `LOCAL,STAGING,PRODUCTION_READONLY` | No | — | No aplica (sin efecto en este endpoint) |
| page | number entero positivo | No | 1 | Página |
| limit | number entero positivo max 100 | No | 20 | Tamaño de página |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| items | JobRun[] | Ver forma abajo, orden `createdAtValue DESC` |
| meta | `{page, limit, total, totalPages}` | Paginación |

Forma `JobRun`: `jobRunId, jobCode, status, startedAt (ISO\|null), completedAt (ISO\|null), inputJson (object), resultJson (object\|null), errorMessage (string\|null), triggeredByType, triggeredById, createdAt (ISO\|null)`.

**Errores**
- Query inválida → `400 BadRequestException`.

---

## Módulo: SystemsTestController

Archivo: `src/modules/systems-ops/systems-test.controller.ts`. Servicios: `SystemsTestQueryService`, `SystemsTestSuiteAdminService` (usa internamente `SystemsTestRunnerService` para ejecutar). Repositorios: `SystemsTestSuiteAdminRepository`, `SystemsTestExecutionRepository`. Mappers: `mapTestSuite`, `mapTestStep`, `mapTestRun`, `mapTestStepRun`.

### POST /api/v1/systems/test-suites

**Propósito:** Crear una suite de pruebas (integración, smoke, regresión, E2E o carga) para un módulo del backend.
**Auth:** igual que módulo. Usa `@CurrentUser()` como `createdBy`.
**Headers:** ninguno especial.

**Path params**
Ninguno.

**Query params**
Ninguno.

**Request body** (`createTestSuiteSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| code | string | Sí | 3-180 chars, regex `^[A-Z0-9_]+$` | Código único de la suite |
| name | string | Sí | 3-220 chars | Nombre |
| description | string | No | max 4000 | Descripción |
| module | string | Sí | 2-120 chars | Módulo al que pertenece |
| suiteType | enum `INTEGRATION,SMOKE,REGRESSION,E2E_API,LOAD` | No | default `INTEGRATION` | Tipo de suite |
| environmentScope | string[] enum `LOCAL,STAGING,PRODUCTION_READONLY` | No | 1-3 items, default `['LOCAL','STAGING']` | Ambientes donde puede correr |
| isEnabled | boolean (coercionado) | No | default `true` | Si está habilitada |
| requiresSeedData | boolean (coercionado) | No | default `true` | Si requiere datos semilla |
| isSafeForProduction | boolean (coercionado) | No | default `false` | Si es segura para correr en `PRODUCTION_READONLY` (solo pasos de solo lectura) |
| requiresDestructivePermission | boolean (coercionado) | No | — (se calcula como `!isSafeForProduction` si se omite) | Si requiere permiso destructivo |

**Response 201**
| Campo | Tipo | Descripción |
|---|---|---|
| suite | TestSuite | Ver forma abajo |
| steps | [] | Siempre vacío al crear (una suite nueva no tiene pasos) |

Forma `TestSuite` (`mapTestSuite`): `suiteId, code, name, description (string\|null), module, suiteType, executionMode (string, fijo 'SYNC_OR_JOB'), environmentScope (string[]), isEnabled (boolean), requiresSeedData (boolean), isSafeForProduction (boolean), requiresDestructivePermission (boolean)`.

**Errores**
- `environmentScope` incluye `PRODUCTION_READONLY` sin `isSafeForProduction=true` → `400 BadRequestException('PRODUCTION_READONLY_REQUIRES_SAFE_SUITE')`.
- Código duplicado (constraint único en BD) → `409 ConflictException('SYSTEM_TEST_SUITE_OR_STEP_ALREADY_EXISTS')`.
- Otro error de persistencia → `400 BadRequestException('SYSTEM_TEST_SUITE_CREATE_FAILED')`.
- Body inválido → `400 BadRequestException` (Zod).

---

### GET /api/v1/systems/test-suites

**Propósito:** Listar suites de prueba con filtros.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
Ninguno.

**Query params** (`systemsSuiteQuerySchema`)
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| module | string (1-120) | No | — | Filtra por módulo |
| suiteType | string CSV (1-200) | No | — | Lista de tipos separada por coma (según `optionalCsv`) |
| enabled | boolean (coercionado) | No | — | Filtra por `isEnabled` |
| page | number entero positivo | No | 1 | Página |
| limit | number entero positivo max 100 | No | 20 | Tamaño de página |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| items | TestSuite[] | Ver forma arriba |
| meta | `{page, limit, total, totalPages}` | Paginación |

**Errores**
- Query inválida → `400 BadRequestException`.

---

### GET /api/v1/systems/test-suites/:suiteId

**Propósito:** Obtener una suite con todos sus pasos ordenados.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| suiteId | string (regex `^[1-9][0-9]*$`) | Id numérico de la suite |

**Query params**
Ninguno.

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| suite | TestSuite | Ver forma arriba |
| steps | TestStep[] | Ver forma abajo, orden `stepOrder ASC` |

Forma `TestStep` (`mapTestStep`): `stepId, suiteId, endpointId (string\|null), stepOrder (number), name, inputMode (enum), method, pathTemplate, defaultHeaders (object), defaultPayload (object), configSchema (object), extractors (object), assertions (object), continueOnFailure (boolean), cleanupRequired (boolean)`.

**Errores**
- No existe → `404 NotFoundException('SYSTEM_TEST_SUITE_NOT_FOUND')`.
- `suiteId` inválido → `400 BadRequestException`.

---

### PATCH /api/v1/systems/test-suites/:suiteId

**Propósito:** Actualizar campos de una suite existente (parcial).
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| suiteId | string (regex `^[1-9][0-9]*$`) | Id numérico de la suite |

**Query params**
Ninguno.

**Request body** (`updateTestSuiteSchema` = `createTestSuiteSchema.partial()`, con refine que exige al menos 1 campo)
Mismos campos que `POST /test-suites` (tabla arriba), todos opcionales, pero el body debe traer **al menos uno**.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| suite | TestSuite | Suite actualizada |
| steps | TestStep[] | Pasos actuales de la suite (sin cambios por este endpoint) |

**Errores**
- No existe → `404 NotFoundException('SYSTEM_TEST_SUITE_NOT_FOUND')`.
- `environmentScope` resultante incluye `PRODUCTION_READONLY` sin `isSafeForProduction=true` → `400 BadRequestException('PRODUCTION_READONLY_REQUIRES_SAFE_SUITE')`.
- Código duplicado → `409 ConflictException('SYSTEM_TEST_SUITE_OR_STEP_ALREADY_EXISTS')`.
- Otro error de persistencia → `400 BadRequestException('SYSTEM_TEST_SUITE_UPDATE_FAILED')`.
- Body vacío o inválido → `400 BadRequestException` (Zod, mensaje `"Debe enviar al menos un campo para actualizar."` si está vacío).

---

### POST /api/v1/systems/test-suites/:suiteId/steps

**Propósito:** Agregar un paso (llamada HTTP) a una suite de pruebas.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| suiteId | string (regex `^[1-9][0-9]*$`) | Id numérico de la suite |

**Query params**
Ninguno.

**Request body** (`createTestStepSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| endpointId | string (regex `^[1-9][0-9]*$`) \| null | No | — | Endpoint del catálogo asociado (debe existir si se envía) |
| stepOrder | number entero (coercionado) | Sí | 1-500 | Orden de ejecución dentro de la suite |
| name | string | Sí | 3-220 chars | Nombre del paso |
| inputMode | enum `DEFAULT,CONFIGURABLE,GENERATED,FROM_PREVIOUS_STEP` | No | default `DEFAULT` | Cómo se arma el payload |
| method | enum `GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD` | Sí | — | Método HTTP a ejecutar |
| pathTemplate | string | Sí | 1-1200 chars, debe iniciar con `/` o `http(s)://` | Plantilla de ruta (soporta placeholders `{{...}}`) |
| defaultHeaders | object libre | No | default `{}` | Headers por defecto del paso |
| defaultPayload | object libre | No | default `{}` | Payload por defecto |
| configSchema | object libre | No | default `{}` | Esquema de configuración parametrizable |
| extractors | object libre | No | default `{}` | JSONPath para extraer valores de la respuesta hacia el contexto de la suite |
| assertions | object libre | No | default `{expectedStatusCodes:[200,201]}` | Reglas de aserción a evaluar |
| continueOnFailure | boolean (coercionado) | No | default `false` | Si continuar la suite pese a que este paso falle |
| cleanupRequired | boolean (coercionado) | No | default `false` | Si requiere limpieza posterior |

**Response 201**: objeto `TestStep` (ver forma arriba).

**Errores**
- Suite no existe → `404 NotFoundException('SYSTEM_TEST_SUITE_NOT_FOUND')`.
- `endpointId` enviado no existe en catálogo → `400 BadRequestException('SYSTEM_TEST_STEP_ENDPOINT_NOT_FOUND')`.
- Suite `isSafeForProduction=true` y `method` no es `GET/HEAD/OPTIONS` → `400 BadRequestException('PRODUCTION_SAFE_SUITE_ONLY_ALLOWS_READONLY_METHODS')`.
- Suite `isSafeForProduction=true` y `pathTemplate` matchea `/run|retry|delete|remove|cancel|approve|reject|resolve|seed|refresh|process/i` → `400 BadRequestException('PRODUCTION_SAFE_SUITE_PATH_LOOKS_MUTATING')`.
- Conflicto de persistencia → `409 ConflictException('SYSTEM_TEST_SUITE_OR_STEP_ALREADY_EXISTS')`.
- Otro error de persistencia → `400 BadRequestException('SYSTEM_TEST_STEP_CREATE_FAILED')`.
- Body inválido → `400 BadRequestException` (Zod).

---

### PATCH /api/v1/systems/test-suites/:suiteId/steps/:stepId

**Propósito:** Actualizar un paso existente de una suite (parcial).
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| suiteId | string (regex `^[1-9][0-9]*$`) | Id numérico de la suite |
| stepId | string (regex `^[1-9][0-9]*$`) | Id numérico del paso |

**Query params**
Ninguno.

**Request body** (`updateTestStepSchema` = `createTestStepSchema.partial()`, exige al menos 1 campo)
Mismos campos que `POST .../steps` (tabla arriba), todos opcionales.

**Response 200**: objeto `TestStep` actualizado.

**Errores**
- Suite no existe → `404 NotFoundException('SYSTEM_TEST_SUITE_NOT_FOUND')`.
- Paso no existe o no pertenece a `suiteId` → `404 NotFoundException('SYSTEM_TEST_STEP_NOT_FOUND')`.
- `endpointId` enviado no existe → `400 BadRequestException('SYSTEM_TEST_STEP_ENDPOINT_NOT_FOUND')`.
- Mismas reglas de seguridad de suite `isSafeForProduction` que en creación → `400 BadRequestException('PRODUCTION_SAFE_SUITE_ONLY_ALLOWS_READONLY_METHODS' | 'PRODUCTION_SAFE_SUITE_PATH_LOOKS_MUTATING')`.
- Conflicto de persistencia → `409 ConflictException('SYSTEM_TEST_SUITE_OR_STEP_ALREADY_EXISTS')`.
- Otro error de persistencia → `400 BadRequestException('SYSTEM_TEST_STEP_UPDATE_FAILED')`.
- Body vacío/inválido → `400 BadRequestException` (Zod).

---

### POST /api/v1/systems/test-suites/:suiteId/steps/reorder

**Propósito:** Reordenar en bloque los pasos de una suite.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| suiteId | string (regex `^[1-9][0-9]*$`) | Id numérico de la suite |

**Query params**
Ninguno.

**Request body** (`reorderTestStepsSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| steps | array de `{stepId, stepOrder}` | Sí | 1-500 items | `stepId`: string regex `^[1-9][0-9]*$`; `stepOrder`: número entero (coercionado) 1-500 |

**Response 201**
| Campo | Tipo | Descripción |
|---|---|---|
| items | TestStep[] | Todos los pasos de la suite tras el reorden, orden `stepOrder ASC` |

**Errores**
- Suite no existe → `404 NotFoundException('SYSTEM_TEST_SUITE_NOT_FOUND')`.
- Algún `stepId` enviado no pertenece a la suite → `400 BadRequestException('SYSTEM_TEST_STEP_NOT_IN_SUITE:<ids>')` (el mensaje incluye los ids desconocidos separados por coma).
- `stepOrder` duplicado entre los items enviados → `400 BadRequestException('SYSTEM_TEST_STEP_DUPLICATED_ORDER')`.
- Otro error de persistencia → `400 BadRequestException('SYSTEM_TEST_STEP_REORDER_FAILED')`.
- Body inválido → `400 BadRequestException` (Zod).

---

### POST /api/v1/systems/test-suites/:suiteId/run

**Propósito:** Ejecutar una suite de pruebas (modo dry-run simulado o ejecución HTTP real contra `baseUrl`), paso a paso, evaluando aserciones y encadenando contexto entre pasos.
**Auth:** igual que módulo. Usa `@CurrentUser()` como `triggeredBy`.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| suiteId | string (regex `^[1-9][0-9]*$`) | Id numérico de la suite a ejecutar |

**Query params**
Ninguno.

**Request body** (`runTestSuiteSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| environment | enum `LOCAL,STAGING,PRODUCTION_READONLY` | No | default `LOCAL` | Ambiente de ejecución; debe estar en `environmentScope` de la suite |
| dryRun | boolean (coercionado) | No | default `true` | Si `true` (o si no se envía `baseUrl`), los pasos se resuelven sin llamada HTTP real |
| baseUrl | string URL | No | — | Requerido si `dryRun=false` |
| config | object libre | No | default `{}` | Config por paso (`step_<n>` o nombre del paso) usada para resolver templates |
| headers | Record<string,string> | No | default `{}` | Headers base combinados con los `defaultHeaders` de cada paso |
| timeoutMs | number entero (coercionado) | No | 100-60000, default `10000` | Timeout por request HTTP real |

**Response 201**
| Campo | Tipo | Descripción |
|---|---|---|
| run.runId | string | Id del run creado |
| run.suiteId | string | Id de la suite |
| run.environment | string | Ambiente ejecutado |
| run.triggeredBy | string \| null | Actor que disparó el run |
| run.status | `'PASSED' \| 'FAILED'` | Resultado agregado (falla si algún paso falló) |
| run.startedAt | string (ISO) \| null | Inicio |
| run.finishedAt | string (ISO) \| null | Fin |
| run.durationMs | number | Duración total |
| run.summary | object | `{dryRun, totalSteps, passed, failed, skipped, extractedContextKeys}` |
| run.logsUrl | string \| null | URL de logs (si aplica) |
| run.createdAt | string (ISO) \| null | Fecha de creación del run |
| steps | TestStepRun[] | Ver forma abajo, uno por cada paso de la suite (incluye `SKIPPED` si la ejecución se detuvo) |

Forma `TestStepRun` (`mapTestStepRun`): `stepRunId, testRunId, stepId, status ('PASSED'|'FAILED'|'SKIPPED'), requestPayloadSanitized (object), responseBodySanitized (object), statusCode (number\|null), durationMs (number), errorMessage (string\|null), createdAt (ISO\|null)`.

**Errores**
- Suite no existe → `404 NotFoundException('SYSTEM_TEST_SUITE_NOT_FOUND')`.
- Suite deshabilitada (`isEnabled=false`) → `400 BadRequestException('SYSTEM_TEST_SUITE_DISABLED')`.
- `environment` no está en `environmentScope` de la suite → `403 ForbiddenException('SYSTEM_TEST_ENVIRONMENT_NOT_ALLOWED_FOR_SUITE')`.
- `environment === 'PRODUCTION_READONLY'` y (`isSafeForProduction=false` o `dryRun=false`) → `403 ForbiddenException('SYSTEM_TEST_PRODUCTION_EXECUTION_BLOCKED')`.
- Ejecución real (`dryRun=false`) sin `baseUrl` → `400 BadRequestException('SYSTEM_TEST_BASE_URL_REQUIRED_FOR_REAL_RUN')`.
- Ejecución real en `environment=LOCAL` con `baseUrl` cuyo host no es `localhost/127.0.0.1/host.docker.internal` → `403 ForbiddenException('SYSTEM_TEST_LOCAL_ENVIRONMENT_REQUIRES_LOCAL_BASE_URL')`.
- Errores dentro de un paso individual (p. ej. `pathTemplate` no resuelve a string, timeout HTTP) **no** se propagan como excepción HTTP: el paso queda marcado `FAILED` con `errorMessage` y la suite continúa o se detiene según `continueOnFailure` de cada paso.
- Body inválido → `400 BadRequestException` (Zod).

---

### GET /api/v1/systems/test-runs

**Propósito:** Listar ejecuciones de suites de prueba.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
Ninguno.

**Query params** (`systemsRunsQuerySchema`)
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| suiteId | string (regex `^[1-9][0-9]*$`) | No | — | Filtra por suite |
| status | enum `QUEUED,RUNNING,PASSED,FAILED,CANCELLED` | No | — | Filtra por estado del run |
| environment | enum `LOCAL,STAGING,PRODUCTION_READONLY` | No | — | Filtra por ambiente |
| page | number entero positivo | No | 1 | Página |
| limit | number entero positivo max 100 | No | 20 | Tamaño de página |

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| items | TestRun[] | Ver forma abajo |
| meta | `{page, limit, total, totalPages}` | Paginación |

Forma `TestRun` (`mapTestRun`): `runId, suiteId, environment, triggeredBy (string\|null), status, startedAt (ISO\|null), finishedAt (ISO\|null), durationMs (number\|null), summary (object\|null), logsUrl (string\|null), createdAt (ISO\|null)`.

**Errores**
- Query inválida → `400 BadRequestException`.

---

### GET /api/v1/systems/test-runs/:runId

**Propósito:** Obtener el detalle de una ejecución de suite, incluyendo el resultado de cada paso.
**Auth:** igual que módulo.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| runId | string (regex `^[1-9][0-9]*$`) | Id numérico del run |

**Query params**
Ninguno.

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| run | TestRun | Ver forma arriba |
| steps | TestStepRun[] | Ver forma en `POST .../run` |

**Errores**
- No existe → `404 NotFoundException('SYSTEM_TEST_RUN_NOT_FOUND')`.
- `runId` inválido → `400 BadRequestException`.

---

<a id="modulo-06"></a>

# Contrato HTTP — Schema Management, Internal Portal, Notifications, Events, Health, Runtime Jobs

Prefijo global: `/api/v1` (`env.API_PREFIX`, aplicado en `src/main.ts` vía `app.setGlobalPrefix(env.API_PREFIX)`).

Notas transversales:
- El único guard global registrado como `APP_GUARD` en `src/app.module.ts` es `ThrottlerGuard` (rate limiting). `JwtAuthGuard` y `RolesGuard` NO son globales: se aplican explícitamente por controlador vía `@UseGuards(...)`. Por eso, cuando un controlador no declara `@UseGuards`, no hay autenticación JWT (solo aplica si el endpoint está `@Public()` o si el módulo lo indica).
- `AuthenticatedUser` (payload derivado del JWT, ver `src/common/types/auth.types.ts`) tiene: `sub` (string), `tenantId?`, `customerId?`, `internalUserId?`, `platformUserId?`, `role` (`customer | internal_operator | risk_analyst | compliance_analyst | fraud_analyst | system | system_admin | qa_engineer | devops | readonly_auditor | merchant | admin | platform_admin`), `tokenVersion?`.
- IDs numéricos (BIGINT de Postgres) se exponen y se reciben como **string** para evitar pérdida de precisión (nunca `number`).
- Cuando un endpoint requiere `x-tenant-id`, el valor se valida con `parsePositiveId` (`src/common/utils/ids/id.util.ts`): debe ser un string que matchee `^[1-9][0-9]*$`; si no, `400 BadRequestException` con mensaje `"x-tenant-id debe ser un entero positivo representado como texto."`.
- Cuando un endpoint requiere `x-idempotency-key` y el header falta, se lanza `400 BadRequestException('X-Idempotency-Key header is required.')` antes de llegar al servicio.

---

## Módulo: Schema Management

Controlador: `src/modules/schema-management/schema-management.controller.ts`
Prefijo del controlador: `@Controller('operations/schema')` → rutas bajo `/api/v1/operations/schema/...`
Guard de clase: `@UseGuards(JwtAuthGuard, RolesGuard)` (todos los endpoints requieren JWT válido; los roles varían por método).

### GET /api/v1/operations/schema/versions

**Propósito:** Listar versiones del catálogo de schema (para navegación de auditoría/consulta de estructura de datos).
**Auth:** JwtAuthGuard + RolesGuard. Roles permitidos: `internal_operator`, `admin`, `platform_admin`, `risk_analyst`, `readonly_auditor`.
**Headers:** ninguno especial (solo `Authorization: Bearer <jwt>`).

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| (ninguno) | | |

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| limit | number (int, 1-100) | No | 20 | Tamaño de página |
| offset | number (int, ≥0) | No | 0 | Desplazamiento |
| includeInactive | boolean (coerced) | No | false | Incluye versiones marcadas `isActive=false` |

Schema Zod: `schemaVersionsListQuerySchema` (`.strict()` — rechaza campos extra con 400).

**Request body**
Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| versions | SchemaVersionDto[] | Lista de versiones (ver forma abajo) |
| total | number | Total de filas que matchean el filtro (sin paginar) |
| limit | number | Eco del limit aplicado |
| offset | number | Eco del offset aplicado |

`SchemaVersionDto`: `_id` (string), `versionCode` (string), `createdAt` (Date/ISO), `createdByPlatformUserId` (string\|null), `notes` (string\|null), `isActive` (boolean), `parentVersionId` (string\|null), `tablesCount` (number), `columnsCount` (number), `relationshipsCount` (number).

**Errores**
- Query inválida (fuera de rango, campo extra) → 400 (ZodValidationPipe).
- Rol no permitido → 403 Forbidden (RolesGuard).
- JWT ausente/ inválido → 401 Unauthorized.

---

### GET /api/v1/operations/schema/versions/:versionId

**Propósito:** Obtener el detalle de una versión de schema específica.
**Auth:** Roles: `internal_operator`, `admin`, `platform_admin`, `risk_analyst`, `readonly_auditor`.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| versionId | string | ID numérico (BIGINT) de la versión; no se valida con Zod en este endpoint (llega como string libre al servicio) |

**Query params:** ninguno.
**Request body:** Sin body.

**Response 200**
`SchemaVersionDto` (misma forma que arriba, objeto único, no envuelto en lista).

**Errores**
- Versión no encontrada → 404 `NotFoundException("Schema version {id} not found")`.
- Rol no permitido → 403. JWT ausente → 401.

---

### GET /api/v1/operations/schema/tables

**Propósito:** Listar tablas catalogadas dentro de una versión de schema.
**Auth:** Roles: `internal_operator`, `admin`, `platform_admin`, `risk_analyst`, `readonly_auditor`.
**Headers:** ninguno especial.

**Path params:** ninguno.

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| versionId | string (numérico, `^\d+$`) | Sí | — | Versión de schema a consultar |
| tableType | enum: `transactional`\|`catalog`\|`audit`\|`operational` | No | — | Filtro por tipo de tabla |
| limit | number (int, 1-100) | No | 50 | Tamaño de página |
| offset | number (int, ≥0) | No | 0 | Desplazamiento |

Schema Zod: `schemaTablesListQuerySchema` (`.strict()`).

**Request body:** Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| tables | SchemaTableDto[] | Lista de tablas |
| total | number | Total de filas |
| limit | number | Eco |
| offset | number | Eco |
| versionId | string | Eco del filtro aplicado |

`SchemaTableDto`: `_id`, `schemaVersionId`, `tableName`, `tableType` (`transactional`\|`catalog`\|`audit`\|`operational`), `isAppendOnly` (boolean), `isTenantScoped` (boolean), `description` (string\|null), `columnsCount` (number, siempre `0` en el listado — no se calculan columnas por fila en list), `relationshipsCount` (number, siempre `0` en el listado), `createdAt` (Date).

**Errores**
- `versionId` inexistente → 404 `NotFoundException("Schema version {versionId} not found")`.
- Query inválida → 400. Rol no permitido → 403. JWT ausente → 401.

---

### GET /api/v1/operations/schema/tables/:tableId

**Propósito:** Obtener el detalle completo de una tabla catalogada, incluyendo columnas y relaciones (FK).
**Auth:** Roles: `internal_operator`, `admin`, `platform_admin`, `risk_analyst`, `readonly_auditor`.
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| tableId | string | ID numérico de la tabla; sin validación Zod explícita en este endpoint |

**Query params:** ninguno. **Request body:** Sin body.

**Response 200**
`SchemaTableDto` con `columnsCount`/`relationshipsCount` recalculados (longitud real de los arrays) y:
- `columns`: `SchemaColumnDto[]` — `_id`, `columnName`, `columnType`, `isNullable` (boolean), `isImmutable` (boolean), `isPii` (boolean), `isIndexed` (boolean), `description` (string\|null).
- `relationships`: `SchemaRelationshipDto[]` — `_id`, `sourceColumnName`, `targetTableName` (string, `'unknown'` si no se resuelve), `targetColumnName`, `cascadeDelete` (boolean), `isImmutable` (boolean).

**Errores**
- Tabla no encontrada → 404 `NotFoundException("Schema table {tableId} not found")`.
- Rol no permitido → 403. JWT ausente → 401.

---

### POST /api/v1/operations/schema/tables

**Propósito:** Proponer la creación de una nueva tabla en el catálogo de schema (flujo de aprobación DDL, fase "propuesta").
**Auth:** Roles: `internal_operator`, `admin`, `platform_admin`. Autorización fina adicional en servicio: solo estos mismos roles pueden proponer (`PROPOSER_ROLES`); si no, 403 `ForbiddenException`.
**Headers:** ninguno especial (no requiere `x-idempotency-key` ni `x-tenant-id`; el catálogo de schema no es tenant-scoped a nivel de request).

**Path params:** ninguno.
**Query params:** ninguno.

**Request body** (`createSchemaTableRequestSchema`, `.strict()`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| tableName | string | Sí | snake_case, `^[a-z][a-z0-9_]*$`, min 3, max 120 | Nombre físico de la tabla propuesta |
| tableType | enum | Sí | `transactional`\|`catalog`\|`audit`\|`operational` | Tipo de tabla |
| isAppendOnly | boolean | No | default `false` | Marca si la tabla es solo-inserción |
| isTenantScoped | boolean | No | default `true` | Si la tabla tiene columna de tenant |
| description | string | No | max 500 | Descripción de negocio |
| columns | array (min 1, max 200) | Sí | — | Ver subcampos abajo |
| columns[].columnName | string | Sí | `^_?[a-z][a-z0-9_]*$`, max 120 | Nombre de columna (permite `_` inicial) |
| columns[].columnType | string | Sí | 1-60 chars | Tipo SQL (ej. `varchar(120)`, `bigint`) |
| columns[].isNullable | boolean | No | default `false` | |
| columns[].isImmutable | boolean | No | default `false` | |
| columns[].isPii | boolean | No | default `false` | Marca de dato personal |
| columns[].isIndexed | boolean | No | default `false` | |
| columns[].defaultValue | string | No | max 255 | |
| columns[].description | string | No | max 255 | |
| relationships | array | No | default `[]` | FKs propuestas |
| relationships[].sourceColumnName | string | Sí | `^_?[a-z][a-z0-9_]*$`, max 120 | Columna origen (en la tabla nueva) |
| relationships[].targetTableName | string | Sí | snake_case, max 120 | Tabla destino de la FK |
| relationships[].targetColumnName | string | Sí | `^_?[a-z][a-z0-9_]*$`, max 120 | Columna destino |
| relationships[].cascadeDelete | boolean | No | default `false` | |
| justification | string | Sí | min 10, max 1000 | Justificación de negocio obligatoria para auditoría |

**Response 201**
`SchemaChangeLogDto` (la propuesta queda registrada como entrada de change-log en estado `pending`):
| Campo | Tipo | Descripción |
|---|---|---|
| _id | string | ID de la entrada de change-log |
| changeId | string | Igual a `_id` |
| schemaVersionId | string\|null | Versión asociada (null en propuestas de tabla nueva) |
| changeType | string | `"CREATE_TABLE"` |
| affectedEntityType | string | `"TABLE"` |
| affectedEntityId | string\|null | |
| changePayload | object | Payload completo enviado (tableName, tableType, columns, relationships, justification, etc.) |
| approvalStatus | `pending`\|`approved`\|`rejected` | `"pending"` al crear |
| requesterPlatformUserId | string | Tomado de `currentUser.platformUserId` |
| approvedByPlatformUserId | string\|null | `null` al crear |
| approvedAt | Date\|null | `null` al crear |
| approvalNotes | string\|null | `null` al crear |
| changeResult | `pending`\|`success`\|`failed`\|`rejected`\|null | `null`/`pending` al crear |
| errorMessage | string\|null | |
| createdAt | Date | |
| rolledBack | boolean | `false` al crear |

**Errores**
- Rol no permitido para proponer → 403 `ForbiddenException`.
- `currentUser.platformUserId` ausente en el token → 403 `ForbiddenException("Schema management actions require an identified platform user...")`.
- Validación semántica del nombre/columnas contra `SchemaManagementValidationService` falla (colisión de nombre, tipo SQL inválido, etc.) → 400 `BadRequestException({ message: 'Schema validation failed', errors: [...] })`.
- Body inválido contra Zod (formato, longitudes) → 400.

---

### GET /api/v1/operations/schema/change-log

**Propósito:** Auditar el historial de cambios DDL propuestos/aprobados/rechazados.
**Auth:** Roles: `internal_operator`, `admin`, `platform_admin`, `risk_analyst`, `readonly_auditor`.
**Headers:** ninguno especial.

**Path params:** ninguno.

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| approvalStatus | enum `pending`\|`approved`\|`rejected` | No | — | Filtro por estado |
| changeType | string, `^[A-Z_]+$`, max 30 | No | — | Ej. `CREATE_TABLE` |
| requesterUserId | string numérico | No | — | Filtro por solicitante |
| limit | number (int, 1-100) | No | 50 | |
| offset | number (int, ≥0) | No | 0 | |

**Request body:** Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| changes | SchemaChangeLogDto[] | Ver forma en el endpoint POST anterior |
| total | number | |
| limit | number | |
| offset | number | |

**Errores**
- Query inválida → 400. Rol no permitido → 403. JWT ausente → 401.

---

### PATCH /api/v1/operations/schema/change-log/:changeId/approve

**Propósito:** Aprobar o rechazar un cambio de schema propuesto (control de 4 ojos: el aprobador no puede ser el solicitante).
**Auth:** Rol requerido: `platform_admin` únicamente (tanto a nivel `@Roles` como en el servicio, `APPROVER_ROLES`).
**Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| changeId | string | ID de la entrada de change-log a resolver |

**Query params:** ninguno.

**Request body** (`approveSchemaChangeRequestSchema`, `.strict()`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| approval | enum `approve`\|`reject` | Sí | — | Decisión |
| approvalNotes | string | Condicional | min 5, max 500 | **Obligatorio si `approval = "reject"`** (validado con `superRefine`; si falta, error en `approvalNotes`) |

**Response 200**
`ApprovalResponseDto`:
| Campo | Tipo | Descripción |
|---|---|---|
| _id | string | ID de la entrada |
| changeId | string | Igual a `_id` |
| approvalStatus | `approved`\|`rejected` | |
| approvedAt | Date | |
| changeResult | `success`\|`failed`\|`pending` | `success` si se aprueba, `rejected` mapeado internamente pero expuesto en `approvalStatus` (nota: el servicio setea `changeResult: 'rejected'` al rechazar aunque el tipo declarado es `success\|failed\|pending`; en la práctica puede llegar el string `'rejected'`) |
| errorMessage | string\|null | |
| message | string | Mensaje humano de confirmación |

**Errores**
- Cambio no encontrado → 404 `NotFoundException("Schema change {changeId} not found")`.
- El cambio ya fue resuelto (no está `pending`) → 409 `ConflictException('Cannot resolve change with status "{status}". Only "pending" changes can be approved or rejected.')`.
- El aprobador es el mismo que propuso el cambio (segregación de funciones) → 403 `ForbiddenException('Segregation of duties: the requester of a schema change cannot approve their own change.')`.
- Rol distinto de `platform_admin` → 403 `ForbiddenException`.
- Rechazo sin `approvalNotes` → 400 (Zod `superRefine`).

---

## Módulo: Internal Portal

Controlador: `src/modules/internal-portal/internal-portal.controller.ts`
Prefijo del controlador: `@Controller('internal')` → rutas bajo `/api/v1/internal/...`
Guard de clase: `@UseGuards(JwtAuthGuard)` — **solo autenticación JWT, sin `RolesGuard` ni `@Roles`**: cualquier usuario autenticado (cualquier rol) puede usar todos los endpoints de este módulo.

Nota general: los query/body de este controlador se tipan como `Record<string, string|number|boolean|undefined>` sin schema Zod ni class-validator — la validación de forma es manual dentro de `InternalPortalService` (parseo defensivo con fallback, sin rechazar campos desconocidos). Paginación estándar: `page` (default 1), `limit`/`pageSize` (default 20, tope 100) → respuesta `{ items, meta: { page, limit, total, totalPages } }` salvo donde se indique.

### GET /api/v1/internal/business-metadata/glossary

**Propósito:** Listar el glosario de negocio (dominios, tablas, columnas documentadas) para consulta desde el portal interno.
**Auth:** JwtAuthGuard (cualquier rol autenticado). **Headers:** ninguno especial.

**Path params:** ninguno.

**Query params**
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| q | string | No | `''` | Búsqueda libre (case-insensitive, contains) sobre todos los campos del item |
| page | number | No | 1 | |
| limit (o pageSize) | number | No | 20 (tope 100) | |

**Request body:** Sin body.

**Response 200**
`{ items: BusinessTermSummary[], meta: { page, limit, total, totalPages } }`. Cada item (fusión de dominios + tablas + columnas de `system_domain_catalog`, `system_data_entity_catalog`, `system_data_field_catalog`):
`termId` (string, prefijo `domain:`/`table:`/`field:`), `key`, `name`, `definition`, `domain`, `owner`, `status`, `relatedTables` (string[]), `relatedColumns` (string[]), `relatedReports` (string[]), `metadata` (object), `updatedAt` (ISO string).

**Errores:** ninguno explícito (consulta siempre devuelve lista, aunque vacía).

---

### GET /api/v1/internal/business-metadata/terms/:termId

**Propósito:** Detalle de un término del glosario.
**Auth:** JwtAuthGuard. **Headers:** ninguno especial.

**Path params**
| Campo | Tipo | Descripción |
|---|---|---|
| termId | string (URL-encoded) | Identificador compuesto `domain:/table:/field:{id}` |

**Response 200:** Item del glosario (igual forma que en el listado) + `synonyms` (string[]), `examples` (string[]), `restrictions` (string[]), `relations` (`{ relationId, relationType, targetType, targetId, targetLabel }[]`), `audit` (`{ auditId, action, actor, createdAt }[]`).

**Errores**
- No encontrado → 404 `NotFoundException('BUSINESS_TERM_NOT_FOUND')`.

---

### GET /api/v1/internal/exports

**Propósito:** Listar exportaciones de datos disponibles (catálogos preconfigurados, no generación dinámica).
**Auth:** JwtAuthGuard. **Headers:** ninguno especial.

**Query params:** `q` (string, opcional), `page`, `limit` (paginación estándar en memoria).

**Response 200:** `{ items, meta }`. Cada item: `exportId`, `name`, `resourceType`, `resourceId` (null), `format` (`"JSON"`), `status` (`"READY"`), `requestedBy`, `requestedAt` (ISO), `finishedAt` (ISO), `expiresAt` (null), `downloadUrl` (string, ruta interna del backend), `metadata` (`{ rows: number, reason: string }`).

**Errores:** ninguno explícito.

---

### GET /api/v1/internal/exports/:exportId

**Propósito:** Detalle de una exportación.
**Auth:** JwtAuthGuard.

**Path params:** `exportId` (string, uno de los 3 IDs fijos seed: `export-endpoint-catalog`, `export-data-catalog`, `export-data-quality`).

**Response 200:** item de export + `reason` (string), `filters` (`{}`), `policySnapshot` (`{ masking: 'no_raw_pii', audit: true }`), `auditRequestId` (string), `errorCode` (null), `errorMessage` (null).

**Errores**
- No encontrado → 404 `NotFoundException('DATA_EXPORT_NOT_FOUND')`.

---

### GET /api/v1/internal/data-quality/rules

**Propósito:** Listar reglas de calidad de datos con conteo de issues abiertos.
**Auth:** JwtAuthGuard.

**Query params:** `q` (string), `page`, `limit`/`pageSize` — paginado a nivel SQL (LIMIT/OFFSET real, no en memoria).

**Response 200:** `{ items, meta }`. Cada item (`mapQualityRule`): `ruleId` (string), `ruleCode` (string), `ruleName` (string), `description` (string generado), `targetTable` (string), `targetField` (string\|null), `ruleType` (string, de `build_phase`), `severity` (string), `status` (`ACTIVE`\|`INACTIVE`), `frequency` (`"on_demand_and_release_gate"`), `owner` (`"data-quality"`), `expectedAction` (string), `checkConfig` (object, de `expression_json`), `lastRunAt` (ISO), `lastRunStatus` (`"completed"`), `openIssues` (number).

**Errores:** ninguno explícito.

---

### GET /api/v1/internal/data-quality/rules/:ruleId

**Propósito:** Detalle de una regla de calidad (busca por `_id` o `rule_code`).
**Auth:** JwtAuthGuard.

**Path params:** `ruleId` (string, ID numérico o `rule_code`, URL-decoded).

**Response 200:** mismo shape que item de listado arriba.

**Errores**
- No encontrado → 404 `NotFoundException('DATA_QUALITY_RULE_NOT_FOUND')`.

---

### POST /api/v1/internal/data-quality/rules/:ruleId/run

**Propósito:** Ejecutar (simulada, controlada por backend) una regla de calidad bajo demanda.
**Auth:** JwtAuthGuard. **HttpCode:** 200 explícito.

**Path params:** `ruleId` (string).
**Request body:** Sin body.

**Response 200:** `{ runId: string, ruleId: string, status: 'completed', startedAt: ISO, finishedAt: ISO, affectedRows: number, summary: { checkedTable, targetField, openIssues, message } }`.

**Errores**
- Regla no encontrada (delegado a `getDataQualityRule`) → 404 `NotFoundException('DATA_QUALITY_RULE_NOT_FOUND')`.

---

### GET /api/v1/internal/governance/policies/:policyId

**Propósito:** Consultar una política de gobierno de datos (propósito de privacidad, retención, clasificación, campo sensible o regla de calidad, unificadas bajo un solo endpoint).
**Auth:** JwtAuthGuard.

**Path params:** `policyId` (string, formato `{kind}:{rawId}` donde `kind` ∈ `purpose|retention|classification|sensitive|quality`; si no lleva `:`, se busca en todos los `kind`).

**Response 200:** objeto de política unificado: `policyId`, `key`, `name`, `policyType` (`PRIVACY_PURPOSE`\|`RETENTION`\|`CLASSIFICATION`\|`SENSITIVE_FIELD`\|`DATA_QUALITY`), `status` (`ACTIVE`\|`INACTIVE`), `version` (`"v1"`), `owner`, `description`, `effectiveFrom` (ISO), `effectiveUntil` (null), `affectedTables` (string[]), `affectedColumns` (string[]), `controls` (`{ controlId, controlType, label, status, config }[]`), `actions` (3 acciones fijas: read/update/delete con flags `enabled`, `requiresApproval`, `requiresReason`, `requiresAudit`), `approvals` (`[]`), `metadata` (object), `updatedAt` (ISO).

**Errores**
- No encontrada en ninguna tabla de política → 404 `NotFoundException('GOVERNANCE_POLICY_NOT_FOUND')`.

---

### PATCH /api/v1/internal/governance/policies/:policyId

**Propósito:** Actualizar (de forma superficial/no persistida en tablas específicas) metadatos visibles de una política.
**Auth:** JwtAuthGuard.

**Path params:** `policyId` (string, mismo formato que arriba).

**Request body**
| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| name | string | No | |
| description | string | No | |
| owner | string | No | |
| status | string | No | |
| policyType | string | No | |
| version | string | No | |

No hay validación de schema (Zod/class-validator); cualquier `Record<string, unknown>` es aceptado, solo se leen las claves de arriba.

**Response 200:** política existente (misma forma que GET) sobrescrita con los campos provistos + `metadata.lastUpdate` (eco del body), `metadata.persisted: false` (advierte que **no** se persiste en la tabla real de política, solo se refleja en la respuesta), `updatedAt` (ISO, ahora).

**Errores**
- Política base no encontrada → 404 `NotFoundException('GOVERNANCE_POLICY_NOT_FOUND')` (delegado a `getGovernancePolicy`).

---

### GET /api/v1/internal/lineage

**Propósito:** Grafo de linaje de datos (nodos: tablas + endpoints; aristas: impactos de endpoint sobre tabla y relaciones FK entre tablas).
**Auth:** JwtAuthGuard.

**Query params:** `q` (string, filtra nodos por substring, no aristas).

**Response 200:** `{ nodes: LineageNode[], edges: LineageEdge[], generatedAt: ISO, summary: { nodeCount, edgeCount, source: 'live_backend_catalog' } }`.
`LineageNode`: `nodeId` (`table:{id}`\|`endpoint:{id}`), `nodeType` (`table`\|`endpoint`), `label`, `domain`, `status`, `criticality` (`HIGH`\|`MEDIUM`\|risk_level del endpoint), `referenceId` (string), `metadata` (object).
`LineageEdge`: `edgeId` (`impact:{id}`\|`relationship:{id}`), `sourceNodeId`, `targetNodeId`, `edgeType`, `label`, `metadata`.

**Errores:** ninguno explícito.

---

### GET /api/v1/internal/lineage/nodes/:nodeId

**Propósito:** Detalle de un nodo del grafo de linaje con sus vecinos.
**Auth:** JwtAuthGuard.

**Path params:** `nodeId` (string, URL-encoded, ej. `table:123`).

**Response 200:** `LineageNode` + `incomingEdges` (LineageEdge[]), `outgoingEdges` (LineageEdge[]), `relatedNodes` (LineageNode[]).

**Errores**
- Nodo no encontrado → 404 `NotFoundException('LINEAGE_NODE_NOT_FOUND')`.

---

### GET /api/v1/internal/lineage/impact

**Propósito:** Listar impactos (aristas del grafo) en formato paginado, para análisis "¿qué se rompe si cambio X?".
**Auth:** JwtAuthGuard.

**Query params:** `q` (string, aplica al grafo subyacente), `page`, `limit`.

**Response 200:** `{ items, meta }`. Item: `impactId` (= edgeId), `sourceNodeId`, `targetNodeId`, `impactType` (= edgeType), `severity` (string, del label), `description` (string), `path` (LineageNode[] — nodos origen/destino).

**Errores:** ninguno explícito.

---

### GET /api/v1/internal/alerts

**Propósito:** Listar alertas operativas derivadas de issues de calidad de datos abiertos.
**Auth:** JwtAuthGuard.

**Query params:** `q` (string), `page`, `limit` — paginado a nivel SQL.

**Response 200:** `{ items, meta }`. Item: `alertId` (`dq:{id}`), `title`, `description`, `severity` (string uppercased), `status` (string uppercased, ej. `OPEN`\|`ACKNOWLEDGED`), `source` (rule_code), `resourceType` (`"data_quality_issue"`), `resourceId` (string), `createdAt` (ISO), `acknowledgedAt` (ISO\|null), `acknowledgedBy` (string\|null), `metadata` (`{ targetTable, targetRecordId }`).

**Errores:** ninguno explícito.

---

### POST /api/v1/internal/alerts/:alertId/acknowledge

**Propósito:** Marcar una alerta (issue de calidad) como reconocida.
**Auth:** JwtAuthGuard. **HttpCode:** 200 explícito.

**Path params:** `alertId` (string, formato `dq:{id}`; el prefijo `dq:` se limpia antes del UPDATE).
**Request body:** Sin body.

**Response 200:** `{ alertId: string, status: 'ACKNOWLEDGED', message: string }`.

**Errores:** ninguno explícito lanzado por el servicio (el `UPDATE` SQL es un no-op silencioso si el ID no existe; no valida existencia previa).

---

### GET /api/v1/internal/jobs

**Propósito:** Listar ejecuciones de jobs de sistema (`system_job_runs`).
**Auth:** JwtAuthGuard.

**Query params:** `q` (string, sobre `job_code`/`status`), `page`, `limit`.

**Response 200:** `{ items, meta }`. Item (`mapJob`): `jobRunId` (string), `jobKey` (string, `job_code`), `name` (string, `job_code` con `_` → espacio), `queue` (string, `triggered_by_type`), `status` (string uppercased), `priority` (`"normal"` fijo), `attempts` (`1` fijo), `durationMs` (number\|null), `startedAt` (ISO\|null), `finishedAt` (ISO\|null), `createdAt` (ISO), `metadata` (`{ triggeredBy, hasError }`).

**Errores:** ninguno explícito.

---

### GET /api/v1/internal/jobs/:jobRunId

**Propósito:** Detalle de una ejecución de job, con payload/resultado y "logs" sintéticos.
**Auth:** JwtAuthGuard.

**Path params:** `jobRunId` (string, ID o `job_code`, URL-decoded).

**Response 200:** item de job (igual forma que arriba) + `requestId` (`job:{id}`), `payloadSummary` (object, de `input_json`), `resultSummary` (object, de `result_json`), `errorCode` (`"JOB_ERROR"`\|null), `errorMessage` (string\|null), `logs` (`{ timestamp, level: 'info', message, details }[]`, un único log sintético).

**Errores**
- No encontrado → 404 `NotFoundException('JOB_RUN_NOT_FOUND')`.

---

### POST /api/v1/internal/jobs/:jobRunId/retry

**Propósito:** Solicitar reintento de un job (no ejecuta reintento real, solo registra intención en la respuesta).
**Auth:** JwtAuthGuard. **HttpCode:** 200.

**Path params:** `jobRunId` (string).
**Request body:** Sin body.

**Response 200:** `{ jobRunId: string, status: 'QUEUED_FOR_RETRY', message: string }`.

**Errores**
- Job no encontrado (delegado a `getJob`) → 404 `NotFoundException('JOB_RUN_NOT_FOUND')`.

---

### POST /api/v1/internal/jobs/:jobRunId/cancel

**Propósito:** Solicitar cancelación de un job (idéntica limitación que retry: no cancela nada real).
**Auth:** JwtAuthGuard. **HttpCode:** 200.

**Path params:** `jobRunId` (string).
**Request body:** Sin body.

**Response 200:** `{ jobRunId: string, status: 'CANCEL_REQUESTED', message: string }`.

**Errores**
- Job no encontrado → 404 `NotFoundException('JOB_RUN_NOT_FOUND')`.

---

### GET /api/v1/internal/release-readiness

**Propósito:** Semáforo de preparación para release, agregando conteos de catálogo/QA/calidad/jobs.
**Auth:** JwtAuthGuard.

**Request/Query/Path:** ninguno. Sin body.

**Response 200:** `{ status: 'ready'|'warning'|'blocked', checks: Check[], blockers: Check[], warnings: Check[], generatedAt: ISO }` donde `Check = { key, label, status: 'ok'|'warning'|'blocked', detail: string, details: object }`. Checks fijos: `endpoint_catalog`, `data_catalog`, `qa_suites`, `data_quality_rules`, `open_quality_issues`, `runtime_jobs`.

**Errores:** ninguno explícito.

---

### GET /api/v1/internal/reports

**Propósito:** Listar reportes/dashboards operativos predefinidos (catálogo estático en código, no tabla).
**Auth:** JwtAuthGuard.

**Query params:** `q` (string), `page`, `limit`.

**Response 200:** `{ items, meta }`. Item (sin `widgets`/`filters`): `reportId`, `key`, `name`, `description`, `domain`, `owner`, `status` (`"ACTIVE"`), `criticality`, `sourceType`, `sourceReference`, `allowedFilters` (object), `permissions` (`{ required: string[] }`), `updatedAt` (ISO fija `2026-01-01T00:00:00.000Z`).

**Errores:** ninguno explícito.

---

### GET /api/v1/internal/reports/:reportId

**Propósito:** Detalle de un reporte, incluyendo widgets y filtros configurables.
**Auth:** JwtAuthGuard.

**Path params:** `reportId` (string, matchea `reportId` o `key`).

**Response 200:** item completo del catálogo de reportes + `widgets` (`{ widgetId, reportId, widgetType, title, description, queryKey, visualConfig, position }[]`) + `filters` (`{ filterId, reportId, key, label, filterType, required, options, defaultValue }[]`).

**Errores**
- No encontrado → 404 `NotFoundException('REPORT_NOT_FOUND')`.

---

### POST /api/v1/internal/reports/:reportId/run

**Propósito:** Ejecutar un reporte (agrega en vivo release-readiness + alerts + jobs; no hay motor de queries dinámico).
**Auth:** JwtAuthGuard. **HttpCode:** 200.

**Path params:** `reportId` (string).

**Request body**
| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| filters | object | No | Filtros libres; se ecoan en la respuesta bajo `data.filters` (si no se envía `filters`, se ecoa el body completo) |

No hay schema Zod; cualquier JSON es aceptado.

**Response 200:** `{ reportId, executionId: string, status: 'completed', generatedAt: ISO, data: { filters, readiness, alerts: AlertItem[], jobs: JobItem[] }, widgets: { widgetId, title, data: { readinessStatus, alertCount, jobCount } }[] }`.

**Errores**
- Reporte no encontrado (delegado a `getReport`, síncrono) → 404 `NotFoundException('REPORT_NOT_FOUND')`.

---

### GET /api/v1/internal/reports/:reportId/snapshots

**Propósito:** Listar snapshots históricos de un reporte (2 snapshots sintéticos: seed + actual).
**Auth:** JwtAuthGuard.

**Path params:** `reportId` (string).
**Query params:** `page`, `limit` (paginación en memoria sobre 2 elementos fijos).

**Response 200:** `{ items, meta }`. Item: `snapshotId`, `reportId`, `status` (`"READY"`), `generatedAt` (ISO), `generatedBy` (string), `summary` (object).

**Errores**
- Reporte no encontrado → 404 `NotFoundException('REPORT_NOT_FOUND')`.

---

### GET /api/v1/internal/search

**Propósito:** Búsqueda global (endpoints catalogados, tablas, reglas de calidad, reportes) para el portal interno.
**Auth:** JwtAuthGuard.

**Query params:** `q` (string; si vacío tras `trim()`, retorna `{ items: [], totals: {} }` sin consultar BD).

**Response 200:** `{ items: SearchResultItem[], totals: { endpoints, tables, qualityRules, reports } }` (máx 15 por categoría). `SearchResultItem`: `id`, `kind` (`endpoint`\|`table`\|`quality_rule`\|`report`), `title`, `subtitle`, `href` (ruta de navegación interna, no HTTP de la API), `status`, `method?`, `riskLevel?`, `containsPii?`.

**Errores:** ninguno explícito.

---

## Módulo: Notifications

Controlador: `src/modules/notifications/notifications.controller.ts`
`@Controller()` sin prefijo propio — cada método define su ruta completa. Guard de clase: `@UseGuards(JwtAuthGuard, RolesGuard)`.
El tenant se resuelve con `tenantIdFromHeader(header, currentUser?)`: usa el header `x-tenant-id` si viene, si no cae a `currentUser.tenantId`; si ninguno está presente o no es numérico positivo → 400.

### GET /api/v1/operations/notifications/messages

**Propósito:** Listar mensajes de notificación (vista operativa interna, todos los canales/destinatarios de un tenant).
**Auth:** Roles: `internal_operator`, `risk_analyst`, `compliance_analyst`, `fraud_analyst`, `admin`, `platform_admin`, `system`.
**Headers:** `x-tenant-id` (requerido, entero positivo string).

**Query params** (`listMessagesQuerySchema`)
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| status | enum: `pending`\|`queued`\|`sending`\|`sent`\|`delivered`\|`read`\|`failed`\|`retrying`\|`cancelled` | No | — | |
| channel | enum: `in_app`\|`push`\|`email`\|`sms`\|`whatsapp`\|`phone` | No | — | |
| recipientType | string, 1-40 | No | — | |
| recipientId | string, 1-120 | No | — | |
| correlationId | string, 1-120 | No | — | |
| from | date (coerced) | No | — | Filtro `createdAt >= from` |
| to | date (coerced) | No | — | Filtro `createdAt <= to` |
| page | number (int, positivo) | No | 1 | |
| limit | number (int, positivo, max 100) | No | 20 | |

**Request body:** Sin body.

**Response 200**
| Campo | Tipo | Descripción |
|---|---|---|
| data | MessageDto[] | Ver `mapMessage` abajo |
| pagination | `{ page, limit, total, totalPages }` | |

`MessageDto` (`mapMessage`): `id` (string), `tenantId` (string\|null), `outboxEventId` (string\|null), `recipientType` (string), `recipientId` (string), `channel` (string), `templateCode` (string\|null), `subject` (string\|null), `title` (string\|null), `body` (string), `payload` (object), `status` (string), `priority` (number), `scheduledAt`, `queuedAt`, `sentAt`, `deliveredAt`, `readAt`, `failedAt`, `cancelledAt` (Date\|null cada uno), `correlationId` (string\|null), `causationId` (string\|null), `createdAt`, `updatedAt` (Date).

**Errores**
- `x-tenant-id` faltante/ inválido → 400.
- Query inválida → 400. Rol no permitido → 403.

---

### GET /api/v1/operations/notifications/messages/:messageId

**Propósito:** Detalle de un mensaje + su historial de intentos de entrega (deliveries).
**Auth:** mismos roles que arriba. **Headers:** `x-tenant-id` (requerido).

**Path params:** `messageId` (string, `^[1-9][0-9]*$`).

**Response 200:** `MessageDto` + `deliveries`: `DeliveryDto[]` (`mapDelivery`): `id`, `notificationMessageId`, `channel`, `provider` (string), `providerMessageId` (string\|null), `status` (string), `attemptNumber` (number), `errorCode` (string\|null), `errorMessage` (string\|null), `sentAt`, `deliveredAt`, `failedAt` (Date\|null), `createdAt` (Date).

**Errores**
- Mensaje no encontrado (por tenant+id) → 404 `NotFoundException('NOTIFICATION_MESSAGE_NOT_FOUND')`.
- `messageId` no matchea el regex → 400 (ZodValidationPipe en params).

---

### POST /api/v1/operations/notifications/messages/:messageId/retry

**Propósito:** Reintentar el envío de un mensaje fallido/cancelado.
**Auth:** Roles: `admin`, `platform_admin`, `system`, `internal_operator`. **HttpCode:** 200.
**Headers:** `x-tenant-id` (requerido), `x-idempotency-key` (**requerido**, si falta → 400 antes de tocar el servicio).

**Path params:** `messageId` (string numérico).
**Request body:** Sin body.

**Response 200:** Igual forma que `GET /messages/:messageId` (mensaje actualizado a `status: 'retrying'` + reintento de entrega orquestado + `deliveries`).

**Errores**
- `x-idempotency-key` ausente → 400.
- Mensaje no encontrado → 404 `NotFoundException('NOTIFICATION_MESSAGE_NOT_FOUND')`.

---

### POST /api/v1/operations/notifications/messages/:messageId/cancel

**Propósito:** Cancelar un mensaje pendiente de envío.
**Auth:** Roles: `admin`, `platform_admin`, `system`, `internal_operator`. **HttpCode:** 200.
**Headers:** `x-tenant-id` (requerido), `x-idempotency-key` (requerido).

**Path params:** `messageId` (string numérico).
**Request body:** Sin body.

**Response 200:** `MessageDto` (mensaje con `status: 'cancelled'`, `cancelledAt` seteado).

**Errores**
- `x-idempotency-key` ausente → 400.
- Mensaje no encontrado → 404 `NotFoundException('NOTIFICATION_MESSAGE_NOT_FOUND')`.
- Mensaje ya en estado `sent`/`delivered`/`read` → 400 `BadRequestException('SENT_MESSAGE_CANNOT_BE_CANCELLED')`.

---

### GET /api/v1/operations/notifications/templates

**Propósito:** Listar plantillas de notificación (globales del tenant `null` + específicas del tenant).
**Auth:** mismos roles de lectura que `listMessages`. **Headers:** `x-tenant-id` (requerido).

**Query params** (`listTemplatesQuerySchema`)
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| code | string, 1-160 | No | — | |
| channel | enum canal | No | — | |
| active | boolean (coerced) | No | — | |
| page | number | No | 1 | |
| limit | number (max 100) | No | 20 | |

**Response 200:** `{ data: TemplateDto[], pagination: { page, limit, total, totalPages } }`.
`TemplateDto` (`mapTemplate`): `id`, `tenantId` (string\|null), `code`, `channel`, `locale`, `titleTemplate` (string\|null), `subjectTemplate` (string\|null), `bodyTemplate` (string), `payloadSchema` (object\|null), `isActive` (boolean), `version` (number), `createdAt`, `updatedAt`.

**Errores**
- `x-tenant-id` inválido → 400. Query inválida → 400. Rol no permitido → 403.

---

### POST /api/v1/operations/notifications/templates

**Propósito:** Crear una plantilla de notificación para el tenant.
**Auth:** Roles: `admin`, `platform_admin`, `system`. **HttpCode:** 201.
**Headers:** `x-tenant-id` (requerido), `x-idempotency-key` (requerido).

**Request body** (`createTemplateSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| code | string | Sí | 3-160 | Código único de plantilla dentro del tenant/canal |
| channel | enum: `in_app`\|`push`\|`email`\|`sms`\|`whatsapp`\|`phone` | Sí | — | |
| locale | string | No | 2-12, default `'es-BO'` | |
| titleTemplate | string\|null | No | max 400 | |
| subjectTemplate | string\|null | No | max 400 | |
| bodyTemplate | string | Sí | 1-5000 | |
| payloadSchema | object\|null | No | — | Record libre |
| isActive | boolean | No | default `true` | |
| version | number | No | entero positivo, default `1` | |

**Response 201:** `TemplateDto` (ver forma arriba).

**Errores**
- `x-idempotency-key` ausente → 400. Body inválido → 400 (Zod). Rol no permitido → 403.
- (No hay chequeo explícito de duplicado `code+channel+locale+version` a nivel de servicio — el `INSERT` fallaría por constraint de BD si existiera uno, propagando el error de Sequelize sin traducir a 409.)

---

### PATCH /api/v1/operations/notifications/templates/:templateId

**Propósito:** Actualizar una plantilla existente (parcial).
**Auth:** Roles: `admin`, `platform_admin`, `system`.
**Headers:** `x-tenant-id` (requerido), `x-idempotency-key` (requerido).

**Path params:** `templateId` (string, `^[1-9][0-9]*$`).

**Request body** (`updateTemplateSchema` = `createTemplateSchema.partial()`): todos los campos de arriba, todos opcionales.

**Response 200:** `TemplateDto` actualizado.

**Errores**
- `x-idempotency-key` ausente → 400.
- Plantilla no encontrada (por tenant+id) → 404 `NotFoundException('NOTIFICATION_TEMPLATE_NOT_FOUND')`.

---

### GET /api/v1/operations/notifications/preferences/:customerId

**Propósito:** Consultar preferencias de canal de notificación de un cliente (vista operativa interna).
**Auth:** mismos roles de lectura interna. **Headers:** `x-tenant-id` (requerido).

**Path params:** `customerId` (string, `^[1-9][0-9]*$`).

**Response 200:** `{ data: PreferenceDto[] }`. `PreferenceDto` (`mapPreference`): `id`, `customerId` (string), `eventCode` (string), `channel` (string), `isEnabled` (boolean), `isRequired` (boolean), `createdAt`, `updatedAt`.

**Errores:** ninguno explícito (lista vacía si no hay preferencias).

---

### PATCH /api/v1/operations/notifications/preferences/:customerId

**Propósito:** Actualizar (upsert) preferencias de canal de notificación de un cliente, desde el panel interno.
**Auth:** Roles: `admin`, `platform_admin`, `system`, `internal_operator`.
**Headers:** `x-tenant-id` (requerido), `x-idempotency-key` (requerido).

**Path params:** `customerId` (string numérico).

**Request body** (`updatePreferencesSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| preferences | array | Sí | min 1, max 100 | |
| preferences[].eventCode | string | Sí | 3-160 | |
| preferences[].channel | enum canal | Sí | — | |
| preferences[].isEnabled | boolean | Sí | — | |
| preferences[].isRequired | boolean | No | default `false` | |

**Response 200:** `{ data: PreferenceDto[] }` (todas las preferencias del cliente tras el upsert).

**Errores**
- `x-idempotency-key` ausente → 400.
- Se intenta deshabilitar (`isEnabled: false`) una preferencia marcada `isRequired` en BD → 400 `BadRequestException('REQUIRED_NOTIFICATION_CANNOT_BE_DISABLED')`.

---

### GET /api/v1/customers/:customerId/notifications

**Propósito:** Listar notificaciones in-app de un cliente (bandeja del cliente final).
**Auth:** Roles: `customer`, `internal_operator`, `admin`, `platform_admin`, `system`. **Headers:** `x-tenant-id` (opcional si viene `customer.tenantId` en el JWT; si no hay ninguno de los dos → 400).

**Path params:** `customerId` (string, `^[1-9][0-9]*$`).

**Query params** (`customerNotificationsQuerySchema`): `status` (enum estado), `channel` (enum canal), `from`/`to` (date), `page` (default 1), `limit` (default 20, max 100).

**Response 200:** `{ data: MessageDto[], pagination: { page, limit, total, totalPages } }` (solo canal `in_app`, forzado en el repositorio).

**Errores**
- Si `currentUser.role === 'customer'` y `customerId` del path ≠ `currentUser.customerId` → 403 `ForbiddenException('CUSTOMER_NOTIFICATION_ACCESS_DENIED')`. Otros roles internos permitidos siempre pasan (nota interna del código: `merchant` está deliberadamente excluido de esta lista de roles internos).
- `x-tenant-id` no resoluble → 400.

---

### GET /api/v1/customers/:customerId/notifications/unread-count

**Propósito:** Contador de notificaciones in-app no leídas de un cliente.
**Auth:** mismos roles que arriba. **Headers:** `x-tenant-id` (igual resolución).

**Path params:** `customerId` (string numérico).

**Response 200:** `{ unread: number }`.

**Errores**
- Acceso cruzado de `customer` a otro `customerId` → 403 `ForbiddenException('CUSTOMER_NOTIFICATION_ACCESS_DENIED')`.

---

### POST /api/v1/customers/:customerId/notifications/:notificationId/read

**Propósito:** Marcar una notificación in-app específica como leída.
**Auth:** mismos roles. **HttpCode:** 200.

**Path params:** `customerId`, `notificationId` (ambos string numérico, `^[1-9][0-9]*$`).
**Request body:** Sin body.

**Response 200:** `MessageDto` (con `status: 'read'`, `readAt` seteado).

**Errores**
- Notificación no encontrada para ese cliente/tenant → 404 `NotFoundException('CUSTOMER_NOTIFICATION_NOT_FOUND')`.
- Acceso cruzado → 403 `ForbiddenException('CUSTOMER_NOTIFICATION_ACCESS_DENIED')`.

---

### POST /api/v1/customers/:customerId/notifications/read-all

**Propósito:** Marcar todas las notificaciones in-app no leídas de un cliente como leídas.
**Auth:** mismos roles. **HttpCode:** 200.

**Path params:** `customerId` (string numérico).
**Request body:** Sin body.

**Response 200:** `{ updated: number }` (cantidad de filas afectadas).

**Errores**
- Acceso cruzado → 403 `ForbiddenException('CUSTOMER_NOTIFICATION_ACCESS_DENIED')`.

---

### POST /api/v1/customers/:customerId/device-tokens

**Propósito:** Registrar/actualizar (upsert por hash de token) un device token para push notifications.
**Auth:** Roles: `customer`, `internal_operator`, `admin`, `platform_admin`, `system`. **HttpCode:** 201.

**Path params:** `customerId` (string numérico).

**Request body** (`upsertDeviceTokenSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| platform | enum: `ios`\|`android`\|`web` | Sí | — | |
| token | string | Sí | 8-500 | Token crudo (se cifra con envelope encryption antes de persistir; nunca se devuelve en claro) |
| deviceId | string\|null | No | max 180 | |

**Response 201:** `DeviceTokenDto` (`mapDeviceToken`): `id`, `customerId` (string), `platform`, `deviceId` (string\|null), `isActive` (boolean), `lastSeenAt` (Date), `createdAt`, `updatedAt`. **El token en claro nunca se expone** — el modelo guarda `tokenHash`/`tokenEncrypted`/`tokenLast4`, ninguno de los cuales se mapea a la respuesta.

**Errores**
- Acceso cruzado (`customer` sobre otro `customerId`) → 403 `ForbiddenException('CUSTOMER_NOTIFICATION_ACCESS_DENIED')`.

---

### DELETE /api/v1/customers/:customerId/device-tokens/:deviceTokenId

**Propósito:** Desactivar (soft) un device token (ej. logout, desinstalación).
**Auth:** mismos roles.

**Path params:** `customerId`, `deviceTokenId` (ambos string numérico).
**Request body:** Sin body.

**Response 200** (Nest default para `@Delete` sin `@HttpCode` explícito es 200, no 204, dado que el método retorna un body): `DeviceTokenDto` con `isActive: false`.

**Errores**
- Token no encontrado para ese cliente/tenant → 404 `NotFoundException('DEVICE_TOKEN_NOT_FOUND')`.
- Acceso cruzado → 403 `ForbiddenException('CUSTOMER_NOTIFICATION_ACCESS_DENIED')`.

---

## Módulo: Events

Controlador: `src/modules/events/events.controller.ts`
Prefijo del controlador: `@Controller('operations/events')` → rutas bajo `/api/v1/operations/events/...`
Guard de clase: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('internal_operator','risk_analyst','compliance_analyst','fraud_analyst','admin','platform_admin','system')` a nivel de **toda la clase** (aplica igual a todos los endpoints de este controlador; no hay overrides por método).

### GET /api/v1/operations/events/catalog

**Propósito:** Obtener el catálogo estático de definiciones de eventos de negocio soportados (event registry).
**Auth:** roles de clase (ver arriba). **Headers:** ninguno especial.

**Response 200:** `{ data: EventRegistryItem[] }`. `EventRegistryItem`: `code` (string, ej. `purchase.created`), `family` (string), `version` (number, `1`), `description` (string autogenerada), `defaultPriority` (number), `allowedAggregateTypes` (string[]).

**Errores:** ninguno explícito.

---

### GET /api/v1/operations/events

**Propósito:** Listar eventos publicados en el outbox (auditoría/observabilidad de eventos de negocio), con paginación por offset o por cursor.
**Auth:** roles de clase. **Headers:** `x-tenant-id` (requerido).

**Query params** (`listEventsQuerySchema`)
| Campo | Tipo | Requerido | Default | Descripción |
|---|---|---|---|---|
| status | enum: `pending`\|`processing`\|`processed`\|`failed`\|`cancelled` | No | — | |
| eventCode | string, 1-160 | No | — | |
| aggregateType | string, 1-120 | No | — | |
| correlationId | string, 1-120 | No | — | |
| page | number (positivo) | No | 1 | Solo aplica si `pagination=offset` |
| limit | number (positivo, max 100) | No | 20 | |
| pagination | enum `offset`\|`cursor` | No | `offset` | Modo de paginación (ATLAS-AUDIT-025: cursor recomendado para tablas de alto crecimiento) |
| cursor | string, max 500 | No | — | Cursor opaco (solo relevante si `pagination=cursor`) |

**Response 200 (modo `offset`):** `{ data: EventDto[], pagination: { mode: 'offset', page, limit, total, totalPages } }`.
**Response 200 (modo `cursor`):** `{ data: EventDto[], pagination: { mode: 'cursor', limit, nextCursor: string|null } }`.

`EventDto` (`eventToResponse`): `id` (string), `tenantId` (string\|null), `eventCode`, `eventFamily`, `eventVersion` (number), `aggregateType`, `aggregateId` (string\|null), `status`, `priority` (number), `attempts` (number), `maxAttempts` (number), `availableAt`, `processedAt`, `failedAt` (Date\|null cada uno), `errorCode` (string\|null), `lastError` (string\|null), `idempotencyKey` (string\|null), `correlationId` (string\|null), `causationId` (string\|null), `sourceModule` (string\|null), `sourceAction` (string\|null), `payload` (object), `metadata` (object), `createdAt`, `updatedAt`.

**Errores**
- `cursor` provisto pero inválido/corrupto → 400 `BadRequestException('cursor inválido o corrupto.')`.
- `x-tenant-id` inválido → 400.

---

### GET /api/v1/operations/events/:eventId

**Propósito:** Detalle de un evento del outbox.
**Auth:** roles de clase. **Headers:** `x-tenant-id` (requerido).

**Path params:** `eventId` (string, `^[1-9][0-9]*$`).

**Response 200:** `EventDto` (ver forma arriba).

**Errores**
- No encontrado (por tenant+id) → 404 `NotFoundException('EVENT_NOT_FOUND')`.

---

### POST /api/v1/operations/events

**Propósito:** Publicar manualmente un evento de negocio al outbox (para pruebas, backfills u orquestación operativa).
**Auth:** roles de clase. **HttpCode:** 201.
**Headers:** `x-tenant-id` (requerido), `x-idempotency-key` (requerido).

**Request body** (`publishEventSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| eventCode | string | Sí | 3-160 | Debe existir en el event registry (`EVENT_REGISTRY`) |
| aggregateType | string | Sí | 2-120 | Debe estar en `allowedAggregateTypes` de la definición del evento |
| aggregateId | string\|null | No | max 120 | |
| payload | object | No | default `{}` | Redactado de campos sensibles antes de persistir (`redactSensitiveObject`) |
| metadata | object | No | default `{}` | Idem |
| priority | number | No | entero 0-1000 | Si se omite, usa `defaultPriority` de la definición o `0` |
| availableAt | date (coerced) | No | — | Fecha desde la cual el evento es elegible para procesarse |
| maxAttempts | number | No | entero positivo, max 10, default `3` | |
| idempotencyKey | string | No | 8-180 | Si se omite, se usa el header `x-idempotency-key` |
| correlationId | string\|null | No | max 120 | |
| causationId | string\|null | No | max 120 | |
| sourceModule | string\|null | No | max 120 | Default `'operations_api'` si se omite |
| sourceAction | string\|null | No | max 120 | Default `'publish_event'` si se omite |

**Response 201:** `EventDto` (evento creado o el ya existente si hay colisión de `idempotencyKey` para el mismo `tenantId`+`eventCode`).

**Errores**
- `x-idempotency-key` ausente → 400.
- `eventCode` no registrado en `EVENT_REGISTRY` → 400 `BadRequestException('EVENT_NOT_REGISTERED: {eventCode}')`.
- `aggregateType` no permitido para ese `eventCode` → 400 `BadRequestException('EVENT_AGGREGATE_NOT_ALLOWED: {eventCode} cannot use {aggregateType}')`.

---

### POST /api/v1/operations/events/:eventId/retry

**Propósito:** Reintentar un evento fallido/cancelado (lo vuelve a `pending`, disponible inmediatamente).
**Auth:** roles de clase. **HttpCode:** 200.
**Headers:** `x-tenant-id` (requerido), `x-idempotency-key` (requerido).

**Path params:** `eventId` (string numérico).
**Request body:** Sin body.

**Response 200:** `EventDto` actualizado (`status: 'pending'`, `availableAt: now`, `failedAt`/`lastError`/`errorCode` limpiados).

**Errores**
- Evento no encontrado → 404 `NotFoundException('EVENT_NOT_FOUND')`.
- Evento ya en estado `processed` → 400 `BadRequestException('PROCESSED_EVENT_CANNOT_BE_RETRIED')`.
- `x-idempotency-key` ausente → 400.

---

### POST /api/v1/operations/events/:eventId/cancel

**Propósito:** Cancelar un evento pendiente/fallido.
**Auth:** roles de clase. **HttpCode:** 200.
**Headers:** `x-tenant-id` (requerido), `x-idempotency-key` (requerido).

**Path params:** `eventId` (string numérico).
**Request body:** Sin body.

**Response 200:** `EventDto` actualizado (`status: 'cancelled'`).

**Errores**
- Evento no encontrado → 404 `NotFoundException('EVENT_NOT_FOUND')`.
- Evento ya en estado `processed` → 400 `BadRequestException('PROCESSED_EVENT_CANNOT_BE_CANCELLED')`.
- `x-idempotency-key` ausente → 400.

---

## Módulo: Health

Controlador: `src/modules/health/health.controller.ts`
Prefijo del controlador: `@Controller('health')` → `/api/v1/health`.
`@SkipThrottle()` a nivel de clase (exento del rate limiting global de `ThrottlerGuard`).

### GET /api/v1/health

**Propósito:** Chequeo de salud del servicio (liveness/readiness), incluyendo conectividad a la base de datos.
**Auth:** `@Public()` — sin JWT, sin roles, endpoint completamente abierto. No hay `@UseGuards` en la clase (no depende de RolesGuard/JwtAuthGuard de todas formas).
**Headers:** ninguno especial.

**Path/Query params:** ninguno. **Request body:** Sin body.

**Response 200** (siempre 200, incluso en estado `degraded` — no hay 503):
| Campo | Tipo | Descripción |
|---|---|---|
| status | `ok`\|`degraded` | `degraded` si la conexión a BD falla |
| service | string | `"atlas-backend"` |
| version | string | `process.env.npm_package_version` o `"0.1.0"` |
| database | `ok`\|`unreachable` | Resultado de `sequelize.authenticate()` |
| uptime | number | Segundos de uptime del proceso (`process.uptime()`, truncado) |
| timestamp | string (ISO) | Momento de la respuesta |

**Errores:** ninguno — los fallos de conexión a BD se capturan internamente y se reflejan en el payload, nunca lanzan excepción HTTP.

---

## Módulo: Runtime Jobs

Controlador: `src/modules/runtime-jobs/runtime-jobs.controller.ts`
Prefijo del controlador: `@Controller('operations/jobs')` → `/api/v1/operations/jobs/...`
Guard de clase: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('admin','platform_admin','system')` a nivel de **toda la clase** (sin overrides por método — los 5 endpoints comparten exactamente los mismos roles).
Todos los endpoints exigen **ambos** headers `x-tenant-id` y `x-idempotency-key` (función compartida `requireHeaders`: primero valida que `x-idempotency-key` exista, luego parsea `x-tenant-id` como entero positivo). Todos quedan registrados como una fila en `system_job_runs` + una entrada de auditoría en `operational_audit_logs`, dentro de una transacción (`runJob`).

### POST /api/v1/operations/jobs/process-outbox

**Propósito:** Job operativo legado que marca como `processed` eventos pendientes del outbox que **no** correspondan a eventos de negocio registrados (compatibilidad; para eventos de negocio reales usar `process-events`). Usa `SELECT ... FOR UPDATE SKIP LOCKED` para evitar doble procesamiento en ejecuciones concurrentes.
**Auth:** roles de clase. **HttpCode:** 200.
**Headers:** `x-tenant-id` (requerido), `x-idempotency-key` (requerido).

**Request body** (`processOutboxSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| limit | number | No | entero positivo, max 500, default `50` | Tope de filas a reclamar |
| dryRun | boolean | No | default `true` | Si `true`, solo cuenta candidatos sin modificar nada |

**Response 200:** `{ jobRunId: string, status: 'completed', result: { selected: number, processed: number, skippedBusinessEvents: number, dryRun: boolean, note: string } }` (envoltura estándar de `runJob`; si el handler lanza, el job queda `status: 'failed'` y el error se re-lanza al cliente).

**Errores**
- Headers faltantes → 400 (`x-idempotency-key` faltante lanza antes que cualquier otra validación; `x-tenant-id` inválido después).
- Rol fuera de `admin`/`platform_admin`/`system` → 403.
- Cualquier error interno durante el handler → se registra `system_job_runs.status='failed'` y se re-lanza (normalmente 500, salvo que el handler lance una excepción Nest explícita).

---

### POST /api/v1/operations/jobs/process-events

**Propósito:** Procesar (o simular) el lote de eventos de negocio pendientes del outbox, disparando la orquestación de notificaciones asociada a cada evento.
**Auth:** roles de clase. **HttpCode:** 200.
**Headers:** `x-tenant-id` (requerido), `x-idempotency-key` (requerido).

**Request body** (`processEventsSchema`, idéntico shape a `processOutboxSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| limit | number | No | entero positivo, max 500, default `50` | |
| dryRun | boolean | No | default `true` | Si `true`, solo selecciona candidatos sin ejecutarlos ni marcarlos |

**Response 200:** `{ jobRunId, status: 'completed', result: { selected: number, processed: number, failed: number, skipped: number, dryRun: boolean, eventIds: string[] } }` (delega en `EventsService.processPendingEvents`; en `dryRun=false` reintenta con backoff exponencial acotado los que fallan, hasta agotar `maxAttempts` del evento).

**Errores**
- Headers faltantes → 400. Rol no permitido → 403.
- Errores por evento individual se capturan internamente (no propagan al cliente): se reflejan en `failed`/`skipped` del resultado, no en el status HTTP.

---

### POST /api/v1/operations/jobs/expire-stale-sessions

**Propósito:** Expirar sesiones de cliente inactivas más allá de un umbral de minutos.
**Auth:** roles de clase. **HttpCode:** 200.
**Headers:** `x-tenant-id` (requerido), `x-idempotency-key` (requerido).

**Request body** (`expireStaleSessionsSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| maxIdleMinutes | number | No | entero positivo, max 43200 (30 días), default `120` | Umbral de inactividad |
| dryRun | boolean | No | default `true` | Si `true`, solo cuenta sesiones candidatas |

**Response 200:** `{ jobRunId, status: 'completed', result: { selected: number, expired: number, cutoff: ISO string, dryRun: boolean } }`.

**Errores**
- Headers faltantes → 400. Rol no permitido → 403.

---

### POST /api/v1/operations/jobs/apply-retention-policies

**Propósito:** Aplicar políticas de retención activas (purga o anonimización) sobre 3 tablas de telemetría cruda mapeadas explícitamente (`address_gps_observations`, `device_snapshots`, `form_field_interaction_events`). Nunca actúa sobre tablas de decisión/auditoría.
**Auth:** roles de clase. **HttpCode:** 200.
**Headers:** `x-tenant-id` (requerido), `x-idempotency-key` (requerido).

**Request body** (`applyRetentionPoliciesSchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| policyCode | string | No | 1-120 | Si se omite, evalúa todas las políticas activas (`retention_policies.is_active = true`) |
| dryRun | boolean | No | default `true` | Si `true`, `destructiveActionsExecuted` siempre es `0` |

**Response 200:** `{ jobRunId, status: 'completed', result: { policiesScanned: number, destructiveActionsExecuted: number, dryRun: boolean, outcomes: { table: string, action: 'delete'|'anonymize', affected: number }[], unmappedPolicies: string[], note: string } }`. `unmappedPolicies` lista códigos de política activos sin tabla registrada en `RETENTION_TARGETS` (ej. `risk-data-365d` sembrada por seeders, deliberadamente sin mapear por ambigüedad legal/producto).

**Errores**
- Headers faltantes → 400. Rol no permitido → 403.

---

### POST /api/v1/operations/jobs/recalculate-data-quality

**Propósito:** Recalcular/reportar el conteo actual de issues de calidad de datos abiertos (global o por cliente).
**Auth:** roles de clase. **HttpCode:** 200.
**Headers:** `x-tenant-id` (requerido), `x-idempotency-key` (requerido).

**Request body** (`recalculateDataQualitySchema`)
| Campo | Tipo | Requerido | Constraints | Descripción |
|---|---|---|---|---|
| customerId | string | No | `^[1-9][0-9]*$` | Si se provee, filtra issues cuyo `target_table='customers'` y `target_record_id=customerId` |
| dryRun | boolean | No | default `true` | No cambia el comportamiento real (el job es de solo lectura; no crea issues nuevos) |

**Response 200:** `{ jobRunId, status: 'completed', result: { openIssues: number, issuesCreated: 0, dryRun: boolean, note: string } }`. `issuesCreated` es siempre `0`: las reglas automáticas de creación de issues quedan pendientes de workers específicos por regla (no implementado aún).

**Errores**
- Headers faltantes → 400. Rol no permitido → 403.
