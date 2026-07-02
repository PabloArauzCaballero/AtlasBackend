import { getString, request, TENANT_ID, uniqueKey } from './http.js';

/**
 * ATLAS-AUDIT-002: primer smoke test que ejercita el módulo `auth` de punta a punta contra un
 * servidor real. A diferencia de otros smoke tests del proyecto, este es autocontenido: no
 * depende de que exista un cliente sembrado con contraseña (los datos de seed no la tienen),
 * así que primero registra un cliente nuevo con contraseña vía `POST /customer-onboarding/start`
 * y luego inicia sesión con esas mismas credenciales.
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
  const loginResult = await request<{ accessToken: string; refreshToken: string }>({
    method: 'POST',
    path: '/auth/login',
    extraHeaders: { 'x-tenant-id': TENANT_ID },
    body: { actorType: 'customer', identifier: email, password },
    expected: [200],
  });
  if (!loginResult.data.accessToken || !loginResult.data.refreshToken) {
    throw new Error('login no devolvió accessToken/refreshToken.');
  }

  // Login con contraseña incorrecta debe fallar con 401, no con un 500.
  await request({
    method: 'POST',
    path: '/auth/login',
    extraHeaders: { 'x-tenant-id': TENANT_ID },
    body: { actorType: 'customer', identifier: email, password: 'contraseña-incorrecta-a-proposito' },
    expected: [401],
  });

  // Refresh: rota el token.
  const refreshed = await request<{ accessToken: string; refreshToken: string }>({
    method: 'POST',
    path: '/auth/refresh',
    body: { refreshToken: loginResult.data.refreshToken },
    expected: [200],
  });
  if (refreshed.data.refreshToken === loginResult.data.refreshToken) {
    throw new Error('refresh no rotó el refresh token (debe devolver uno distinto al original).');
  }

  // El refresh token original ya rotado no debe volver a funcionar (evidencia de rotación real).
  await request({
    method: 'POST',
    path: '/auth/refresh',
    body: { refreshToken: loginResult.data.refreshToken },
    expected: [401],
  });

  // Logout con el refresh token vigente.
  await request({
    method: 'POST',
    path: '/auth/logout',
    body: { refreshToken: refreshed.data.refreshToken, allDevices: false },
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
