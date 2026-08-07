import { ATLAS_USER_ROLES, type AtlasUserRole } from '../../src/common/types/auth.types.js';
import {
  INTERNAL_ROLE_CODES,
  ROLE_PERMISSION_CODES,
  legacyRoleForInternalRoles,
  type InternalRoleCode,
} from '../../src/modules/internal-users/internal-rbac.seed-data.js';
import { ACCESS_TOKEN_COOKIE } from '../../src/common/utils/http/auth-cookies.util.js';
import { PLATFORM_USER_ID, TENANT_ID, cookieValue, getArrayFromPaths, getStringFromPaths, request, uniqueKey } from './http.js';
import { requireSmokeEnv } from './required-smoke-env.js';

/**
 * Smoke por TIPO DE USUARIO contra un servidor y una base REALES.
 *
 * Atlas cruza tres vocabularios de identidad y ninguno se validaba completo de punta a punta:
 *
 *   1. `actorType` del login: `customer`, `internal_user`, `platform_user`.
 *   2. `AtlasUserRole`: el claim `role` del token, que es lo que leen `@Roles(...)`/`RolesGuard`.
 *   3. `InternalRoleCode`: los 20 roles RBAC internos que gobiernan `@InternalPermissions(...)`.
 *
 * Este smoke recorre los tres: crea un usuario interno POR CADA rol RBAC, inicia sesión con cada
 * uno y compara sus permisos efectivos contra `ROLE_PERMISSION_CODES` (la misma matriz que el
 * seeder de producción escribe en la base), además de verificar los tres tipos de actor y los 13
 * roles legacy. La versión sin base de datos vive en `test/e2e/user-types/user-types.spec.ts`.
 *
 * Variables obligatorias:
 *   INTERNAL_SMOKE_PASSWORD        contraseña del admin interno que crea a los demás.
 *   INTERNAL_SMOKE_ROLE_PASSWORD   contraseña que se asigna a los usuarios creados por este smoke.
 *   PLATFORM_SMOKE_PASSWORD        solo si el usuario de plataforma ya tenía credenciales.
 */

type JsonRecord = Record<string, unknown>;

const ADMIN_EMAIL = process.env.INTERNAL_SMOKE_EMAIL ?? 'pablo@atlas.internal';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} no es string[]: ${JSON.stringify(value)}`);
  }
  return value;
}

function bearer(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}` };
}

/**
 * Sesión interna ya resuelta: el perfil del cuerpo y el token, venga de donde venga.
 *
 * El login del portal interno responde `tokenType: 'Cookie'` y entrega el access token en una
 * cookie `HttpOnly` (`atlas_internal_access`), no en el cuerpo — es deliberado, para que un XSS en
 * el portal no pueda leerlo. Por eso el token se busca primero en el cuerpo (por si algún día
 * vuelve a viajar ahí) y, si no está, en la cookie.
 */
type InternalSession = { profile: JsonRecord; accessToken: string };

async function loginInternal(email: string, password: string): Promise<InternalSession> {
  const login = await request<JsonRecord>({
    method: 'POST',
    path: '/internal/auth/login',
    extraHeaders: { 'x-tenant-id': TENANT_ID },
    body: { tenantId: TENANT_ID, email, password },
    expected: [200],
  });

  const fromCookie = cookieValue(login.setCookie, ACCESS_TOKEN_COOKIE);
  const accessToken = fromCookie ?? getStringFromPaths(login.data, [['data', 'accessToken'], ['accessToken']]);

  return { profile: login.data, accessToken };
}

function profileArray(login: InternalSession, field: 'roles' | 'permissions'): string[] {
  return asStringArray(
    getArrayFromPaths<unknown>(login.profile, [
      ['data', 'user', field],
      ['user', field],
    ]),
    `${field} del usuario interno`,
  );
}

/** ------------------------------------------------------------------ tipo de actor: customer */

async function checkCustomerActor(unique: string): Promise<void> {
  const phone = `+5917${unique.slice(-7)}`;
  const email = `smoke-usertypes-${unique}@atlas.test`;
  const password = `AtlasUserTypes-${unique}`;

  await request({
    method: 'POST',
    path: '/customer-onboarding/start',
    idempotencyKey: uniqueKey('smoke-usertypes-onboarding'),
    body: {
      customer: { phone, email, firstName: 'Smoke', lastName: 'UserTypes' },
      password,
      consents: [{ consentDocumentId: '1', purposeCode: 'onboarding', granted: true }],
      device: {
        deviceFingerprintHash: `smoke-usertypes-fp-${unique}`.padEnd(32, '0'),
        fingerprintVersion: 'v1',
        channel: 'mobile_app',
        userAgent: 'AtlasSmoke/1.0',
      },
    },
    expected: [201],
  });

  const login = await request<JsonRecord>({
    method: 'POST',
    path: '/auth/login',
    extraHeaders: { 'x-tenant-id': TENANT_ID },
    body: { actorType: 'customer', identifier: email, password },
    expected: [200],
  });
  const accessToken = getStringFromPaths(login.data, [['data', 'accessToken'], ['accessToken']]);
  assert(accessToken.length > 20, 'el login de cliente no devolvió un accessToken utilizable.');

  // Un cliente autenticado no puede entrar por la puerta del personal interno.
  await request({
    method: 'GET',
    path: '/internal/users',
    extraHeaders: bearer(accessToken),
    expected: [403],
  });

  console.log('[SMOKE] tipo de actor `customer`: alta, login y barrera contra el portal interno OK.');
}

/** ------------------------------------------------- tipo de actor: internal_user (20 roles RBAC) */

type CreatedInternalUser = {
  roleCode: InternalRoleCode;
  email: string;
  permissions: string[];
  accessToken: string;
};

async function createAndLoginInternalUser(
  adminHeaders: Record<string, string>,
  roleCode: InternalRoleCode,
  password: string,
  unique: string,
  index: number,
): Promise<CreatedInternalUser> {
  const slug = roleCode.toLowerCase().replace(/_/g, '-');
  const email = `smoke-${slug}.${unique.toLowerCase()}@atlas.internal`;

  const created = await request<JsonRecord>({
    method: 'POST',
    path: '/internal/auth/signup',
    extraHeaders: adminHeaders,
    body: {
      tenantId: TENANT_ID,
      email,
      fullName: `Smoke ${roleCode}`,
      userCode: `SMK${index}-${unique.slice(-8)}`,
      department: 'SYSTEMS',
      jobTitle: `Smoke ${roleCode}`,
      password,
      mustChangePassword: false,
      roles: [roleCode],
      reason: `Smoke de tipos de usuario: cobertura del rol ${roleCode}`,
    },
    expected: [201],
  });

  const createdRoles = asStringArray(
    getArrayFromPaths<unknown>(created.data, [
      ['data', 'user', 'roles'],
      ['user', 'roles'],
    ]),
    `roles del usuario ${roleCode} recién creado`,
  );
  assert(createdRoles.includes(roleCode), `el alta de ${roleCode} no devolvió ese rol: ${createdRoles.join(', ')}`);

  const login = await loginInternal(email, password);
  const roles = profileArray(login, 'roles');
  const permissions = profileArray(login, 'permissions');
  assert(roles.includes(roleCode), `el login de ${roleCode} no devolvió ese rol: ${roles.join(', ')}`);

  return { roleCode, email, permissions, accessToken: login.accessToken };
}

/**
 * Los permisos efectivos que devuelve el login deben cubrir la matriz declarada. Se comprueba la
 * inclusión (no la igualdad) porque el repositorio expande alias de permisos: puede devolver de
 * más, nunca de menos.
 */
function assertPermissionsMatchMatrix(user: CreatedInternalUser): void {
  const granted = new Set(user.permissions);
  const missing = ROLE_PERMISSION_CODES[user.roleCode].filter((permission) => !granted.has(permission));
  assert(
    missing.length === 0,
    `el rol ${user.roleCode} inició sesión sin permisos que ROLE_PERMISSION_CODES sí le asigna: ${missing.join(', ')}`,
  );
}

/** `GET /internal/users` exige `internal.users.read`: 200 si la matriz lo concede, 403 si no. */
async function assertInternalUsersGate(user: CreatedInternalUser): Promise<void> {
  const shouldPass = ROLE_PERMISSION_CODES[user.roleCode].includes('internal.users.read');
  await request({
    method: 'GET',
    path: '/internal/users',
    extraHeaders: bearer(user.accessToken),
    expected: [shouldPass ? 200 : 403],
  });
}

async function checkInternalActorRoles(adminHeaders: Record<string, string>, unique: string): Promise<void> {
  const password = requireSmokeEnv('INTERNAL_SMOKE_ROLE_PASSWORD');

  for (const [index, roleCode] of INTERNAL_ROLE_CODES.entries()) {
    const user = await createAndLoginInternalUser(adminHeaders, roleCode, password, unique, index);

    // Todo usuario interno, sin importar su rol funcional, debe poder leer su propio perfil.
    const me = await request<JsonRecord>({
      method: 'GET',
      path: '/internal/auth/me',
      extraHeaders: bearer(user.accessToken),
      expected: [200],
    });
    const meEmail = getStringFromPaths(me.data, [
      ['data', 'user', 'email'],
      ['user', 'email'],
    ]);
    assert(meEmail === user.email, `/internal/auth/me devolvió otro email para ${roleCode}: ${meEmail}`);

    assertPermissionsMatchMatrix(user);
    await assertInternalUsersGate(user);

    console.log(`[SMOKE] rol interno ${roleCode}: alta, login, permisos efectivos y gate de /internal/users OK.`);
  }

  console.log(`[SMOKE] tipo de actor \`internal_user\`: los ${INTERNAL_ROLE_CODES.length} roles RBAC verificados.`);
}

/** ------------------------------------------------------------ tipo de actor: platform_user */

/**
 * El usuario de plataforma es el único actor sin `tenantId`. Su `role_code` en base debe pertenecer
 * a `ATLAS_USER_ROLES`: si no, `AuthActorResolverService` lo descarta y el login devuelve 401 como
 * si la contraseña fuera incorrecta — el fallo que este bloque existe para detectar.
 */
async function checkPlatformActor(adminHeaders: Record<string, string>, unique: string): Promise<void> {
  const generatedPassword = `AtlasPlatformSmoke-${unique}`;

  // ATLAS-SEC-007: un `admin` es un administrador DE TENANT. Provisionar un `platform_user` —que no
  // pertenece a ningún tenant y opera sobre toda la plataforma— es un acto de alcance plataforma y
  // debe rebotar con 403. Antes esto respondía 201: la escalada que la auditoría integral del
  // 2026-08-06 verificó explotable en vivo. Se comprueba PRIMERO para que una regresión falle aquí.
  await request({
    method: 'POST',
    path: '/auth/provision-credentials',
    extraHeaders: adminHeaders,
    body: { actorType: 'platform_user', actorId: PLATFORM_USER_ID, password: generatedPassword },
    expected: [403],
  });

  const provisioned = await request({
    method: 'POST',
    path: '/auth/provision-credentials',
    role: 'platform_admin',
    body: { actorType: 'platform_user', actorId: PLATFORM_USER_ID, password: generatedPassword },
    expected: [201, 409],
  });

  // 409 = una corrida anterior ya fijó la contraseña; sin ella no se puede continuar, y adivinar
  // un valor por defecto está prohibido (ver required-smoke-env.ts).
  const password = provisioned.status === 201 ? generatedPassword : requireSmokeEnv('PLATFORM_SMOKE_PASSWORD');

  const login = await request<JsonRecord>({
    method: 'POST',
    path: '/auth/login',
    body: { actorType: 'platform_user', identifier: process.env.PLATFORM_SMOKE_EMAIL ?? 'pablo.platform@atlas.test', password },
    expected: [200],
  });
  const accessToken = getStringFromPaths(login.data, [['data', 'accessToken'], ['accessToken']]);
  assert(accessToken.length > 20, 'el login de plataforma no devolvió un accessToken utilizable.');

  console.log('[SMOKE] tipo de actor `platform_user`: provisión de credenciales y login OK.');
}

/** --------------------------------------------- roles legacy del claim `role` (ATLAS_USER_ROLES) */

/**
 * `/internal/auth/me` no exige un rol legacy concreto, pero sí una sesión interna. Recorrer los 13
 * roles con tokens de herramienta (los que emite `scripts/create-dev-jwt.ts`) verifica que el
 * vocabulario que acepta `JwtAuthGuard` es exactamente `ATLAS_USER_ROLES`: ninguno debe rebotar con
 * 401, que es la respuesta a un rol desconocido.
 */
async function checkLegacyRoleVocabulary(): Promise<void> {
  for (const role of ATLAS_USER_ROLES) {
    const response = await request({
      method: 'GET',
      path: '/internal/auth/me',
      role,
      expected: [200, 403, 404],
    });
    assert(response.status !== 401, `el rol legacy ${role} fue rechazado con 401: JwtAuthGuard no reconoce un rol de ATLAS_USER_ROLES.`);
  }

  // Un rol fuera del vocabulario sí debe rebotar. Se firma con el mismo secreto para aislar la
  // causa: lo que se rechaza es el ROL, no la firma.
  await request({
    method: 'GET',
    path: '/internal/auth/me',
    role: 'rol_inexistente' as AtlasUserRole,
    expected: [401],
  });

  console.log(`[SMOKE] roles legacy: los ${ATLAS_USER_ROLES.length} roles de ATLAS_USER_ROLES son aceptados y uno inventado no.`);
}

/**
 * Todo rol legacy que un usuario interno REAL puede acabar teniendo sale de este mapeo. Si algún
 * día devolviera un valor fuera de `ATLAS_USER_ROLES`, ese usuario tendría un token que el guard
 * rechaza: quedaría creado y sin poder entrar.
 */
function checkLegacyRoleMapping(): void {
  const known = new Set<string>(ATLAS_USER_ROLES);
  const invalid = INTERNAL_ROLE_CODES.map((roleCode) => legacyRoleForInternalRoles([roleCode])).filter((role) => !known.has(role));
  assert(invalid.length === 0, `legacyRoleForInternalRoles produce roles fuera de ATLAS_USER_ROLES: ${invalid.join(', ')}`);
}

/** --------------------------------------------------------------------------------- entrypoint */

export async function runUserTypesSmoke(): Promise<void> {
  const unique = uniqueKey('usertypes').replace(/[^a-zA-Z0-9-]/g, '');
  checkLegacyRoleMapping();

  const adminLogin = await loginInternal(ADMIN_EMAIL, requireSmokeEnv('INTERNAL_SMOKE_PASSWORD'));
  const adminHeaders = bearer(adminLogin.accessToken);
  // `getStringFromPaths` y no `getString(..., fallback)`: el argumento de respaldo se evalúa ANTES
  // que la ruta principal, así que un respaldo que a su vez busca una ruta inexistente lanza
  // siempre, aunque la ruta principal sí exista. Este helper prueba las rutas en orden.
  const adminId = getStringFromPaths(adminLogin.profile, [
    ['data', 'user', 'id'],
    ['user', 'id'],
  ]);
  console.log(`[SMOKE] admin interno autenticado: id=${adminId}`);

  await checkCustomerActor(unique);
  await checkInternalActorRoles(adminHeaders, unique);
  await checkPlatformActor(adminHeaders, unique);
  await checkLegacyRoleVocabulary();

  console.log('[SMOKE] user-types: los 3 tipos de actor, los 20 roles RBAC y los 13 roles legacy verificados.');
}

if (process.argv[1]?.endsWith('user-types.smoke.ts') || process.argv[1]?.endsWith('user-types.smoke.js')) {
  runUserTypesSmoke()
    .then(() => {
      console.log('[SMOKE] user-types.smoke.ts completado.');
    })
    .catch((error: unknown) => {
      console.error('[SMOKE] user-types.smoke.ts falló:', error);
      process.exitCode = 1;
    });
}
