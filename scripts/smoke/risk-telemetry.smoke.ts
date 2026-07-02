import { CUSTOMER_ID, DEVICE_ID, SESSION_ID, getStringFromPaths, request, uniqueKey } from './http.js';

export async function runRiskTelemetrySmoke(): Promise<void> {
  const now = new Date();
  const later = new Date(now.getTime() + 30_000);

  await request({
    method: 'POST',
    path: `/customers/${CUSTOMER_ID}/telemetry/batch`,
    role: 'customer',
    idempotencyKey: uniqueKey('smoke-telemetry'),
    body: {
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      clientBatchId: uniqueKey('batch'),
      capturedFrom: now.toISOString(),
      capturedUntil: later.toISOString(),
      events: [
        {
          eventType: 'customer_action',
          eventCode: 'smoke_action_open_app',
          occurredAt: now.toISOString(),
          metadata: { source: 'smoke', screen: 'home' },
        },
      ],
      onDeviceMetrics: [
        {
          metricCode: 'smoke_contact_graph_score',
          value: 0.82,
          computedAt: now.toISOString(),
          confidenceScore: 0.9,
        },
      ],
    },
  });

  const risk = await request<Record<string, unknown>>({
    method: 'POST',
    path: `/customers/${CUSTOMER_ID}/risk-assessments`,
    role: 'customer',
    idempotencyKey: uniqueKey('smoke-risk'),
    body: {
      assessmentType: 'manual_recheck',
      channel: 'mobile_app',
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      requestedLimitContext: { purpose: 'smoke_test' },
    },
  });

  const riskAssessmentRunId = getStringFromPaths(risk.data, [['data', 'riskAssessmentRunId'], ['riskAssessmentRunId']]);
  await request({ method: 'GET', path: `/operations/risk-assessments/${riskAssessmentRunId}`, role: 'admin' });
  await request({ method: 'GET', path: `/operations/risk-assessments/${riskAssessmentRunId}/explanation`, role: 'admin' });
}

if (process.argv[1]?.endsWith('risk-telemetry.smoke.ts') || process.argv[1]?.endsWith('risk-telemetry.smoke.js')) {
  void runRiskTelemetrySmoke();
}
