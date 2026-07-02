import { CUSTOMER_ID, DEVICE_ID, getString, request, uniqueKey } from './http.js';

export async function runSessionsSmoke(): Promise<void> {
  const fp = `smoke-session-fingerprint-${Date.now()}`;
  const started = await request<Record<string, unknown>>({
    method: 'POST',
    path: `/customers/${CUSTOMER_ID}/sessions/start`,
    role: 'customer',
    idempotencyKey: uniqueKey('smoke-session-start'),
    body: {
      authMethod: 'jwt',
      device: {
        deviceFingerprintHash: fp,
        fingerprintVersion: 'v1',
        channel: 'mobile_app',
        userAgent: 'AtlasSmoke/1.0',
        snapshot: {
          brand: 'Smoke',
          model: 'CLI',
          osFamily: 'node',
          osVersion: '20',
          appVersion: '0.1.0',
          isRooted: false,
          isEmulator: false,
          vpnDetected: false,
        },
      },
      gpsObservation: { lat: -17.7833, lng: -63.1821, accuracyMeters: 20, capturedAt: new Date().toISOString() },
      permissions: [{ permissionCode: 'location', granted: true, decidedAt: new Date().toISOString() }],
      locationPermissionGranted: true,
      simObservation: { phoneNumberHash: 'smoke-phone-hash', phoneLast4: '0000', carrierName: 'Tigo', simType: 'physical', simCount: 1 },
      ipReputation: { isVpn: false, isProxy: false, isTor: false, countryCode: 'BO', city: 'Santa Cruz', reputationScore: 0.1 },
    },
  });

  const sessionId = getString(started.data, ['sessionId'], getString(started.data, ['data', 'sessionId'], '1'));
  const deviceId = getString(started.data, ['deviceId'], getString(started.data, ['data', 'deviceId'], DEVICE_ID));

  await request({
    method: 'POST',
    path: `/customers/${CUSTOMER_ID}/sessions/${sessionId}/heartbeat`,
    role: 'customer',
    idempotencyKey: uniqueKey('smoke-session-heartbeat'),
    body: {
      deviceId,
      clientHeartbeatId: uniqueKey('hb'),
      capturedAt: new Date().toISOString(),
      gpsObservation: { lat: -17.7829, lng: -63.1818, accuracyMeters: 18 },
      permissionChanges: [{ permissionCode: 'location', granted: true, decidedAt: new Date().toISOString() }],
      locationPermissionGranted: true,
      deviceSnapshot: { isRooted: false, isEmulator: false, vpnDetected: false, appVersion: '0.1.1' },
    },
  });

  await request({ method: 'GET', path: `/customers/${CUSTOMER_ID}/session-state`, role: 'customer' });
  await request({ method: 'GET', path: `/operations/sessions/${sessionId}/investigation-summary`, role: 'admin' });
  await request({
    method: 'POST',
    path: `/customers/${CUSTOMER_ID}/sessions/${sessionId}/end`,
    role: 'customer',
    idempotencyKey: uniqueKey('smoke-session-end'),
    body: { deviceId, endedAt: new Date().toISOString(), reasonCode: 'smoke_logout' },
  });
}

if (process.argv[1]?.endsWith('sessions.smoke.ts') || process.argv[1]?.endsWith('sessions.smoke.js')) {
  void runSessionsSmoke().catch((error) => {
    console.error('[FAIL] smoke:sessions');
    console.error(error);
    process.exitCode = 1;
  });
}
