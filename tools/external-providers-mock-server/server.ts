import { createServer, IncomingMessage, ServerResponse } from 'node:http';

const port = Number(process.env.MOCK_PROVIDERS_PORT ?? 4010);
let activeScenario = process.env.MOCK_PROVIDERS_SCENARIO ?? 'happy_path';
const defaultLatencyMs = Number(process.env.MOCK_PROVIDERS_DEFAULT_LATENCY_MS ?? 300);

const scenarios = [
  'happy_path',
  'provider_down',
  'timeout',
  'slow_response',
  'invalid_payload',
  'unauthorized',
  'rate_limited',
  'not_found',
  'partial_match',
  'data_not_available',
  'manual_review_required',
  'cost_blocked',
  'duplicate_request',
  'provider_internal_error',
  'fraud_signal_high',
  'low_confidence',
  'expired_token',
  'revoked_consent',
];

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function send(res: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function scenarioFor(req: IncomingMessage, body: Record<string, unknown>): string {
  const headerScenario = req.headers['x-mock-scenario'];
  if (typeof headerScenario === 'string' && headerScenario) return headerScenario;
  if (typeof body.scenario === 'string' && body.scenario) return body.scenario;
  return activeScenario;
}

function providerError(scenario: string): { statusCode: number; payload: Record<string, unknown> } | null {
  if (scenario === 'provider_down')
    return { statusCode: 503, payload: { status: 'PROVIDER_UNAVAILABLE', reasonCode: 'MOCK_PROVIDER_DOWN' } };
  if (scenario === 'unauthorized') return { statusCode: 401, payload: { status: 'UNAUTHORIZED', reasonCode: 'MOCK_UNAUTHORIZED' } };
  if (scenario === 'rate_limited') return { statusCode: 429, payload: { status: 'RATE_LIMITED', reasonCode: 'MOCK_RATE_LIMITED' } };
  if (scenario === 'provider_internal_error')
    return { statusCode: 500, payload: { status: 'PROVIDER_INTERNAL_ERROR', reasonCode: 'MOCK_INTERNAL_ERROR' } };
  return null;
}

function segip(scenario: string): Record<string, unknown> {
  if (scenario === 'partial_match')
    return {
      provider: 'SEGIP',
      status: 'PARTIAL_MATCH',
      documentExists: true,
      nameMatches: false,
      birthDateMatches: true,
      extensionMatches: true,
      complementMatches: true,
      matchScore: 0.62,
      manualReviewRequired: true,
      providerReference: 'SEGIP-MOCK-REF-002',
    };
  if (scenario === 'not_found')
    return {
      provider: 'SEGIP',
      status: 'NOT_FOUND',
      documentExists: false,
      matchScore: 0,
      manualReviewRequired: true,
      providerReference: 'SEGIP-MOCK-REF-404',
    };
  if (scenario === 'data_not_available') return { provider: 'SEGIP', status: 'DATA_NOT_AVAILABLE', reasonCode: 'DATA_NOT_AVAILABLE' };
  return {
    provider: 'SEGIP',
    status: 'FOUND',
    documentExists: true,
    nameMatches: true,
    birthDateMatches: true,
    extensionMatches: true,
    complementMatches: true,
    matchScore: 0.98,
    providerReference: 'SEGIP-MOCK-REF-001',
  };
}

function infocenter(scenario: string): Record<string, unknown> {
  if (scenario === 'cost_blocked')
    return {
      provider: 'INFOCENTER',
      status: 'BLOCKED_BY_COST_POLICY',
      reasonCode: 'INFOCENTER_HIGH_COST_REQUIRES_MANUAL_APPROVAL',
      estimatedCostAmount: 0,
      currency: 'BOB',
    };
  if (scenario === 'not_found') return { provider: 'INFOCENTER', status: 'NOT_FOUND' };
  return {
    provider: 'INFOCENTER',
    status: 'COMPLETED',
    bureauScore: 680,
    activeDebtCount: 2,
    maxDaysPastDue12m: 0,
    estimatedCostAmount: 0,
    currency: 'BOB',
    providerReference: 'INFOCENTER-MOCK-001',
  };
}

function qr(scenario: string): Record<string, unknown> {
  if (scenario === 'not_found')
    return {
      provider: 'QR_GENERIC',
      status: 'PAYMENT_NOT_FOUND',
      amountMatches: false,
      referenceMatches: false,
      providerReference: 'QR-MOCK-404',
    };
  if (scenario === 'partial_match')
    return {
      provider: 'QR_GENERIC',
      status: 'PAYMENT_PARTIAL_MATCH',
      amountMatches: false,
      referenceMatches: true,
      paidAmount: 590,
      currency: 'BOB',
      manualReviewRequired: true,
      providerReference: 'QR-MOCK-PARTIAL',
    };
  if (scenario === 'duplicate_request')
    return {
      provider: 'QR_GENERIC',
      status: 'DUPLICATE_PAYMENT_REFERENCE',
      amountMatches: true,
      referenceMatches: true,
      duplicateDetected: true,
      manualReviewRequired: true,
      providerReference: 'QR-MOCK-DUP',
    };
  return {
    provider: 'QR_GENERIC',
    status: 'PAYMENT_VERIFIED',
    amountMatches: true,
    referenceMatches: true,
    paidAmount: 600,
    currency: 'BOB',
    paidAt: '2026-01-01T12:00:00Z',
    providerReference: 'QR-MOCK-001',
  };
}

function banking(scenario: string): Record<string, unknown> {
  if (scenario === 'happy_path')
    return {
      provider: 'BANKING_GENERIC',
      status: 'VERIFIED',
      amountMatches: true,
      referenceMatches: true,
      providerReference: 'BANK-MOCK-OK',
    };
  return {
    provider: 'BANKING_GENERIC',
    status: 'PENDING',
    amountMatches: null,
    referenceMatches: null,
    providerReference: 'BANK-MOCK-001',
  };
}

function telco(scenario: string): Record<string, unknown> {
  if (scenario === 'fraud_signal_high')
    return {
      provider: 'TELCO_GENERIC',
      status: 'VERIFIED',
      phoneNumberActive: true,
      lineAgeDays: 3,
      lineAgeBucket: 'NEW',
      recentSimChangeDetected: true,
      simSwapRiskLevel: 'HIGH',
      ownerMatchScore: 0.42,
      manualReviewRequired: true,
    };
  return {
    provider: 'TELCO_GENERIC',
    status: 'VERIFIED',
    phoneNumberActive: true,
    lineAgeDays: 720,
    lineAgeBucket: 'OLD',
    recentSimChangeDetected: false,
    simSwapRiskLevel: 'LOW',
    ownerMatchScore: 0.9,
    manualReviewRequired: false,
  };
}

function facebook(scenario: string): Record<string, unknown> {
  if (scenario === 'expired_token')
    return { provider: 'FACEBOOK_META', status: 'TOKEN_EXPIRED', reasonCode: 'EXPIRED_TOKEN', accountAgeAvailable: false };
  if (scenario === 'revoked_consent')
    return { provider: 'FACEBOOK_META', status: 'REVOKED', reasonCode: 'REVOKED_CONSENT', accountAgeAvailable: false };
  return {
    provider: 'FACEBOOK_META',
    status: 'CONNECTED',
    profileIdHash: 'mock_hash',
    nameMatchScore: 0.91,
    emailMatch: true,
    accountAgeAvailable: false,
    accountAgeDays: null,
    reasonCode: 'DATA_NOT_AVAILABLE',
  };
}

function whatsapp(scenario: string): Record<string, unknown> {
  if (scenario === 'not_found')
    return { provider: 'WHATSAPP_GENERIC', status: 'NOT_REACHABLE', whatsappReachable: false, phoneMatch: false, contactabilityScore: 0.1 };
  if (scenario === 'low_confidence')
    return {
      provider: 'WHATSAPP_GENERIC',
      status: 'OTP_UNCERTAIN',
      whatsappReachable: true,
      phoneMatch: false,
      contactabilityScore: 0.35,
      manualReviewRequired: true,
    };
  return { provider: 'WHATSAPP_GENERIC', status: 'OTP_VERIFIED', whatsappReachable: true, phoneMatch: true, contactabilityScore: 0.96 };
}

function digitalTrust(scenario: string): Record<string, unknown> {
  if (scenario === 'fraud_signal_high')
    return {
      provider: 'DIGITAL_TRUST_GENERIC',
      status: 'COMPLETED',
      emailRiskLevel: 'MEDIUM',
      deviceRiskScore: 0.78,
      ipRiskScore: 0.84,
      syntheticIdentityRiskLevel: 'HIGH',
      manualReviewRequired: true,
    };
  return {
    provider: 'DIGITAL_TRUST_GENERIC',
    status: 'COMPLETED',
    emailRiskLevel: 'LOW',
    deviceRiskScore: 0.15,
    ipRiskScore: 0.18,
    syntheticIdentityRiskLevel: 'LOW',
    manualReviewRequired: false,
  };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '/';
  if (url === '/mock/health') return send(res, 200, { ok: true, activeScenario, scenarios });
  if (url === '/mock/scenarios' && req.method === 'GET') return send(res, 200, { activeScenario, scenarios });
  if (url === '/mock/reset' && req.method === 'POST') {
    activeScenario = 'happy_path';
    return send(res, 200, { ok: true, activeScenario });
  }

  const body = await readBody(req);
  const scenario = scenarioFor(req, body);
  if (url === '/mock/scenarios/active' && req.method === 'POST') {
    activeScenario = scenario;
    return send(res, 200, { ok: true, activeScenario });
  }

  const latencyHeader = req.headers['x-mock-latency-ms'];
  const latencyMs = typeof latencyHeader === 'string' ? Number(latencyHeader) : scenario === 'slow_response' ? 3500 : defaultLatencyMs;
  if (scenario === 'timeout') await new Promise((resolve) => setTimeout(resolve, latencyMs + 9_000));
  else await new Promise((resolve) => setTimeout(resolve, latencyMs));

  if (scenario === 'invalid_payload') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{ invalid-json');
  }

  const error = providerError(scenario);
  if (error) return send(res, error.statusCode, error.payload);

  if (url.includes('/mock/segip/')) return send(res, 200, segip(scenario));
  if (url.includes('/mock/infocenter/')) return send(res, 200, infocenter(scenario));
  if (url.includes('/mock/qr/')) return send(res, 200, qr(scenario));
  if (url.includes('/mock/banking/')) return send(res, 200, banking(scenario));
  if (url.includes('/mock/telco/')) return send(res, 200, telco(scenario));
  if (url.includes('/mock/facebook/')) return send(res, 200, facebook(scenario));
  if (url.includes('/mock/whatsapp/')) return send(res, 200, whatsapp(scenario));
  if (url.includes('/mock/digital-trust/')) return send(res, 200, digitalTrust(scenario));

  send(res, 404, { status: 'NOT_FOUND', path: url });
}

createServer((req, res) => {
  handle(req, res).catch((error) =>
    send(res, 500, { status: 'MOCK_SERVER_ERROR', error: error instanceof Error ? error.message : 'Unknown' }),
  );
}).listen(port, () => {
  console.log(`[external-providers-mock-server] listening on http://localhost:${port}`);
});
