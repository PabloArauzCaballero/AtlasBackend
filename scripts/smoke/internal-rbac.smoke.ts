import { getArrayFromPaths, getStringFromPaths, request, TENANT_ID, uniqueKey } from './http.js';

type JsonRecord = Record<string, unknown>;

const PABLO_EMAIL = process.env.INTERNAL_SMOKE_EMAIL ?? 'pablo@atlas.internal';
const PABLO_PASSWORD = process.env.INTERNAL_SMOKE_PASSWORD ?? 'Atlas_Pablo#2026!';
const QA_PASSWORD = process.env.INTERNAL_SMOKE_QA_PASSWORD ?? 'Atlas_QA#2026!';
const EXPECTED_PABLO_ROLES = ['SUPER_ADMIN', 'SYSTEMS_ADMIN', 'DATA_GOVERNANCE_MANAGER'];
const MINIMUM_FRONTEND_PERMISSION_GROUPS = [
  ['auth.internal.me.read'],
  ['internal.users.read', 'rbac.internal_users.read'],
  [
    'internal.users.manage',
    'rbac.internal_users.create',
    'rbac.internal_users.disable',
    'rbac.internal_users.manage_roles',
    'rbac.internal_users.update',
  ],
];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} no es string[]: ${JSON.stringify(value)}`);
  }
  return value;
}

function getArray(value: unknown, paths: string[][], label: string): string[] {
  return asStringArray(getArrayFromPaths<unknown>(value, paths), label);
}

function assertIncludesAll(actual: readonly string[], expected: readonly string[], label: string): void {
  const missing = expected.filter((item) => !actual.includes(item));
  assert(missing.length === 0, `${label} no contiene: ${missing.join(', ')}. Actual: ${actual.join(', ')}`);
}

function assertIncludesPermissionGroups(actual: readonly string[], expectedGroups: readonly string[][], label: string): void {
  const missing = expectedGroups.filter((group) => !group.some((item) => actual.includes(item)));
  assert(
    missing.length === 0,
    `${label} no contiene permisos equivalentes para: ${missing.map((group) => group.join(' | ')).join(', ')}. Actual: ${actual.join(', ')}`,
  );
}

async function loginInternal(email: string, password: string): Promise<JsonRecord> {
  const login = await request<JsonRecord>({
    method: 'POST',
    path: '/internal/auth/login',
    extraHeaders: { 'x-tenant-id': TENANT_ID },
    body: { tenantId: TENANT_ID, email, password },
    expected: [200],
  });

  const accessToken = getStringFromPaths(login.data, [['data', 'accessToken'], ['accessToken']]);
  const refreshToken = getStringFromPaths(login.data, [['data', 'refreshToken'], ['refreshToken']]);
  assert(accessToken.length > 20, 'login interno no devolvió accessToken válido.');
  assert(refreshToken.length > 20, 'login interno no devolvió refreshToken válido.');

  return login.data;
}

function authHeaders(login: JsonRecord): Record<string, string> {
  const accessToken = getStringFromPaths(login, [['data', 'accessToken'], ['accessToken']]);
  return { authorization: `Bearer ${accessToken}` };
}

function userIdFrom(login: JsonRecord): string {
  return getStringFromPaths(login, [
    ['data', 'user', 'id'],
    ['user', 'id'],
  ]);
}

function refreshTokenFrom(login: JsonRecord): string {
  return getStringFromPaths(login, [['data', 'refreshToken'], ['refreshToken']]);
}

export async function runInternalRbacSmoke(): Promise<void> {
  const unique = uniqueKey('internal-rbac').replace(/[^a-zA-Z0-9-]/g, '');

  const pabloLogin = await loginInternal(PABLO_EMAIL, PABLO_PASSWORD);
  const pabloHeaders = authHeaders(pabloLogin);
  const pabloId = userIdFrom(pabloLogin);
  const pabloRoles = getArray(
    pabloLogin,
    [
      ['data', 'user', 'roles'],
      ['user', 'roles'],
    ],
    'roles de Pablo',
  );
  const pabloPermissions = getArray(
    pabloLogin,
    [
      ['data', 'user', 'permissions'],
      ['user', 'permissions'],
    ],
    'permisos de Pablo',
  );

  assertIncludesAll(pabloRoles, EXPECTED_PABLO_ROLES, 'roles de Pablo');
  assertIncludesPermissionGroups(pabloPermissions, MINIMUM_FRONTEND_PERMISSION_GROUPS, 'permisos para frontend interno de Pablo');

  const me = await request<JsonRecord>({
    method: 'GET',
    path: '/internal/auth/me',
    extraHeaders: pabloHeaders,
    expected: [200],
  });
  const meEmail = getStringFromPaths(me.data, [
    ['data', 'user', 'email'],
    ['user', 'email'],
  ]);
  const mePermissions = getArray(
    me.data,
    [
      ['data', 'user', 'permissions'],
      ['user', 'permissions'],
    ],
    'permisos de /me',
  );
  assert(meEmail === PABLO_EMAIL, `/internal/auth/me devolvió email inesperado: ${meEmail}`);
  assertIncludesPermissionGroups(mePermissions, MINIMUM_FRONTEND_PERMISSION_GROUPS, 'permisos de /me para frontend interno');

  const users = await request<JsonRecord>({
    method: 'GET',
    path: '/internal/users',
    extraHeaders: pabloHeaders,
    expected: [200],
  });
  const items = getArrayFromPaths<JsonRecord>(users.data, [['data', 'items'], ['items']]);
  assert(
    items.some((item) => item.email === PABLO_EMAIL),
    `listado de usuarios internos no contiene a ${PABLO_EMAIL}`,
  );

  const roles = await request<JsonRecord>({ method: 'GET', path: '/internal/roles', extraHeaders: pabloHeaders, expected: [200] });
  const roleItems = getArrayFromPaths<JsonRecord>(roles.data, [['data', 'items'], ['items']]);
  assert(
    roleItems.some((item) => item.code === 'SUPER_ADMIN'),
    'catálogo de roles no contiene SUPER_ADMIN',
  );

  const permissions = await request<JsonRecord>({
    method: 'GET',
    path: '/internal/permissions',
    extraHeaders: pabloHeaders,
    expected: [200],
  });
  const permissionItems = getArrayFromPaths<JsonRecord>(permissions.data, [['data', 'items'], ['items']]);
  assert(
    permissionItems.some((item) => item.code === 'internal.users.read' || item.code === 'rbac.internal_users.read'),
    'catálogo de permisos no contiene internal.users.read ni rbac.internal_users.read',
  );

  const qaEmail = `qa.${unique.toLowerCase()}@atlas.internal`;
  const qaUserCode = `QA-${unique.slice(-10)}`;
  const qaCreated = await request<JsonRecord>({
    method: 'POST',
    path: '/internal/auth/signup',
    extraHeaders: pabloHeaders,
    body: {
      tenantId: TENANT_ID,
      email: qaEmail,
      fullName: 'QA Internal Atlas Smoke',
      userCode: qaUserCode,
      department: 'SYSTEMS',
      jobTitle: 'QA Smoke Tester',
      password: QA_PASSWORD,
      mustChangePassword: true,
      roles: ['QA_ENGINEER'],
      reason: 'Prueba smoke RBAC interno automatizada',
    },
    expected: [201],
  });
  const qaCreatedEmail = getStringFromPaths(qaCreated.data, [
    ['data', 'user', 'email'],
    ['user', 'email'],
  ]);
  const qaCreatedRoles = getArray(
    qaCreated.data,
    [
      ['data', 'user', 'roles'],
      ['user', 'roles'],
    ],
    'roles QA creado',
  );
  assert(qaCreatedEmail === qaEmail, `signup interno creó email inesperado: ${qaCreatedEmail}`);
  assertIncludesAll(qaCreatedRoles, ['QA_ENGINEER'], 'roles de QA creado');

  const qaLogin = await loginInternal(qaEmail, QA_PASSWORD);
  const qaHeaders = authHeaders(qaLogin);
  const qaRoles = getArray(
    qaLogin,
    [
      ['data', 'user', 'roles'],
      ['user', 'roles'],
    ],
    'roles QA login',
  );
  const qaPermissions = getArray(
    qaLogin,
    [
      ['data', 'user', 'permissions'],
      ['user', 'permissions'],
    ],
    'permisos QA login',
  );
  assertIncludesAll(qaRoles, ['QA_ENGINEER'], 'roles de QA login');
  assertIncludesAll(qaPermissions, ['auth.internal.me.read', 'systems.qa.read'], 'permisos mínimos de QA');

  await request({
    method: 'POST',
    path: '/internal/auth/login',
    extraHeaders: { 'x-tenant-id': TENANT_ID },
    body: { tenantId: TENANT_ID, email: PABLO_EMAIL, password: 'password-incorrecto-a-proposito' },
    expected: [401],
  });

  await request({
    method: 'POST',
    path: '/internal/auth/signup',
    body: {
      tenantId: TENANT_ID,
      email: `sin-token.${unique.toLowerCase()}@atlas.internal`,
      fullName: 'Sin Token Smoke',
      userCode: `NO-${unique.slice(-8)}`,
      department: 'SYSTEMS',
      jobTitle: 'No Token',
      password: QA_PASSWORD,
      roles: ['QA_ENGINEER'],
      reason: 'Debe fallar por falta de token',
    },
    expected: [401],
  });

  await request({
    method: 'GET',
    path: '/internal/users',
    extraHeaders: qaHeaders,
    expected: [403],
  });

  await request({
    method: 'PATCH',
    path: `/internal/users/${pabloId}`,
    extraHeaders: pabloHeaders,
    body: { status: 'disabled', reason: 'Debe fallar por autodesactivacion' },
    expected: [403],
  });

  await request({
    method: 'PATCH',
    path: `/internal/users/${pabloId}/roles`,
    extraHeaders: pabloHeaders,
    body: { roles: ['QA_ENGINEER'], reason: 'Debe fallar por autoreemplazo de roles' },
    expected: [403],
  });

  const refreshed = await request<JsonRecord>({
    method: 'POST',
    path: '/internal/auth/refresh',
    body: { refreshToken: refreshTokenFrom(pabloLogin) },
    expected: [200],
  });
  const rotatedRefreshToken = getStringFromPaths(refreshed.data, [['data', 'refreshToken'], ['refreshToken']]);
  assert(rotatedRefreshToken !== refreshTokenFrom(pabloLogin), 'refresh interno no rotó el refresh token.');

  await request({
    method: 'POST',
    path: '/internal/auth/refresh',
    body: { refreshToken: refreshTokenFrom(pabloLogin) },
    expected: [401],
  });

  await request({
    method: 'POST',
    path: '/internal/auth/logout',
    body: { refreshToken: rotatedRefreshToken, allDevices: false },
    expected: [200],
  });

  console.log(
    '[SMOKE] internal-rbac: login interno, /me, usuarios, signup protegido, roles, permisos, barreras 401/403, refresh y logout OK.',
  );
}

if (process.argv[1]?.endsWith('internal-rbac.smoke.ts') || process.argv[1]?.endsWith('internal-rbac.smoke.js')) {
  runInternalRbacSmoke()
    .then(() => {
      console.log('[SMOKE] internal-rbac.smoke.ts completado.');
    })
    .catch((error: unknown) => {
      console.error('[SMOKE] internal-rbac.smoke.ts falló:', error);
      process.exitCode = 1;
    });
}
