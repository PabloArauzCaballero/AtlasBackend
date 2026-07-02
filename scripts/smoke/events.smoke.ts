import { CUSTOMER_ID, getStringFromPaths, request, uniqueKey } from './http.js';

export async function runEventsSmoke(): Promise<void> {
  const key = uniqueKey('smoke-user-registered-event');
  const correlationId = uniqueKey('smoke-events-run');
  const eventBody = {
    eventCode: 'user.registered',
    aggregateType: 'customer',
    aggregateId: CUSTOMER_ID,
    payload: { customerId: CUSTOMER_ID, smoke: true },
    metadata: { source: 'smoke' },
    priority: 1000,
    idempotencyKey: key,
    correlationId,
    sourceModule: 'smoke',
    sourceAction: 'events_smoke',
  };

  const created = await request({
    method: 'POST',
    path: '/operations/events',
    role: 'admin',
    idempotencyKey: key,
    body: eventBody,
  });
  const eventId = getStringFromPaths(created.data, [['data', 'id'], ['id']]);
  await request({ method: 'GET', path: `/operations/events/${eventId}`, role: 'admin' });
  await request({
    method: 'GET',
    path: `/operations/events?correlationId=${encodeURIComponent(correlationId)}&page=1&limit=10`,
    role: 'admin',
  });
  await request({
    method: 'POST',
    path: '/operations/jobs/process-events',
    role: 'admin',
    idempotencyKey: uniqueKey('smoke-process-events'),
    body: { limit: 500, dryRun: false },
  });

  const replayed = await request({
    method: 'POST',
    path: '/operations/events',
    role: 'admin',
    idempotencyKey: key,
    body: eventBody,
  });
  const replayedEventId = getStringFromPaths(replayed.data, [['data', 'id'], ['id']]);
  if (replayedEventId !== eventId) throw new Error(`Idempotencia inválida: expected event ${eventId}, got ${replayedEventId}`);
}

if (process.argv[1]?.endsWith('events.smoke.ts') || process.argv[1]?.endsWith('events.smoke.js')) {
  void runEventsSmoke();
}
