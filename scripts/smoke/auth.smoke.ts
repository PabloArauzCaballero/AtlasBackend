import { getString, getStringFromPaths, request, TENANT_ID, uniqueKey } from './http.js';

/**
 * Smoke test autocontenido para auth: crea un cliente con contraseña vía onboarding y luego
 * valida login, refresh y logout contra un servidor real.
 */
export async function runAuthSmoke(): Promise<void> {
  const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const phone = `+5917${unique.slice(-7)}`;
  const email = `smoke-auth-${unique}@atlas.test`;
  const password = `AtlasSmokeTest-${unique}`;

  const onboarded = await request<Record<string, unknown>>({
    method: 'POST',
    path: '/customer-onboarding/start',
    idempotencyKey: uniqueKey('smoke-auth-onboarding'),
    body: {
      customer: { phone, email, firstName: 'Smoke', lastName: 'Auth' },
      password,
      consents: [{ consentDocumentId: '1', purposeCode: 'onboarding', granted: true }],
      device: {
        deviceFingerprintHash: `smoke-auth-fp-${unique}`.padEnd(32, '0'),
        fingerprintVersion: 'v1',
        channel: 'mobile_app',
        userAgent: 'AtlasSmoke/1.0',
      },
    },
    expected: [201],
  });

  const customerId = getString(onboarded.data, ['customerId'], getString(onboarded.data, ['data', 'customerId']));
  console.log(`[SMOKE] cliente de prueba creado: customerId=${customerId}`);

  // Login con las credenciales recién creadas.
  const loginResult = await request<Record<string, unknown>>({
    method: 'POST',
    path: '/auth/login',
    extraHeaders: { 'x-tenant-id': TENANT_ID },
    body: { actorType: 'customer', identifier: email, password },
    expected: [200],
  });
  const accessToken = getStringFromPaths(loginResult.data, [['data', 'accessToken'], ['accessToken']]);
  const refreshToken = getStringFromPaths(loginResult.data, [['data', 'refreshToken'], ['refreshToken']]);
  if (!accessToken || !refreshToken) {
    throw new Error('login no devolvió accessToken/refreshToken.');
  }

  // La contraseña incorrecta debe fallar como rechazo de credenciales.
  await request({
    method: 'POST',
    path: '/auth/login',
    extraHeaders: { 'x-tenant-id': TENANT_ID },
    body: { actorType: 'customer', identifier: email, password: 'contraseña-incorrecta-a-proposito' },
    expected: [401],
  });

  // Refresh: rota el token.
  const refreshed = await request<Record<string, unknown>>({
    method: 'POST',
    path: '/auth/refresh',
    body: { refreshToken },
    expected: [200],
  });
  const newRefreshToken = getStringFromPaths(refreshed.data, [['data', 'refreshToken'], ['refreshToken']]);
  if (newRefreshToken === refreshToken) {
    throw new Error('refresh no rotó el refresh token (debe devolver uno distinto al original).');
  }

  // El refresh token original ya rotado no debe volver a funcionar (evidencia de rotación real).
  await request({
    method: 'POST',
    path: '/auth/refresh',
    body: { refreshToken },
    expected: [401],
  });

  // Logout con el refresh token vigente.
  await request({
    method: 'POST',
    path: '/auth/logout',
    body: { refreshToken: newRefreshToken, allDevices: false },
    expected: [200],
  });

  // Provisión de credenciales para un actor interno: requiere rol admin.
  await request({
    method: 'POST',
    path: '/auth/provision-credentials',
    role: 'admin',
    body: { actorType: 'internal_user', actorId: '1', password: `AtlasSmokeInternal-${unique}` },
    // 201 si el actor interno seed no tenía credenciales todavía, 409 si un run previo ya las creó.
    expected: [201, 409],
  });

  // Un rol no-admin no debe poder provisionar credenciales.
  await request({
    method: 'POST',
    path: '/auth/provision-credentials',
    role: 'internal_operator',
    body: { actorType: 'internal_user', actorId: '1', password: `AtlasSmokeInternal2-${unique}` },
    expected: [403],
  });

  console.log('[SMOKE] auth: login, contraseña incorrecta, refresh (con rotación), logout y provisión de credenciales OK.');
}

if (process.argv[1]?.endsWith('auth.smoke.ts') || process.argv[1]?.endsWith('auth.smoke.js')) {
  runAuthSmoke()
    .then(() => {
      console.log('[SMOKE] auth.smoke.ts completado.');
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error('[SMOKE] auth.smoke.ts falló:', error);
      process.exit(1);
    });
}
