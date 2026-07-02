import { CUSTOMER_ID, getArrayFromPaths, getString, request, uniqueKey } from './http.js';

function findById(items: Array<Record<string, unknown>>, id: string): Record<string, unknown> | undefined {
  return items.find((item) => String(item.id ?? '') === id);
}

export async function runNotificationsSmoke(): Promise<void> {
  const eventKey = uniqueKey('smoke-notification-event');
  const correlationId = uniqueKey('smoke-notifications-run');
  const startedAt = new Date(Date.now() - 5_000).toISOString();

  await request({
    method: 'POST',
    path: '/operations/events',
    role: 'admin',
    idempotencyKey: eventKey,
    body: {
      eventCode: 'user.email.verified',
      aggregateType: 'customer',
      aggregateId: CUSTOMER_ID,
      payload: { customerId: CUSTOMER_ID, smoke: true },
      metadata: { source: 'smoke' },
      priority: 1000,
      idempotencyKey: eventKey,
      correlationId,
      sourceModule: 'smoke',
      sourceAction: 'notifications_smoke',
    },
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await request({
      method: 'POST',
      path: '/operations/jobs/process-events',
      role: 'admin',
      idempotencyKey: uniqueKey('smoke-notification-process'),
      body: { limit: 500, dryRun: false },
    });
    const eventStatus = await request({
      method: 'GET',
      path: `/operations/events?correlationId=${encodeURIComponent(correlationId)}&page=1&limit=10`,
      role: 'admin',
    });
    const events = getArrayFromPaths<Record<string, unknown>>(eventStatus.data, [['data', 'data'], ['data']]);
    if (events.some((event) => event.status === 'processed')) break;
  }

  const messages = await request({
    method: 'GET',
    path: `/operations/notifications/messages?recipientType=customer&recipientId=${CUSTOMER_ID}&channel=in_app&correlationId=${encodeURIComponent(correlationId)}&page=1&limit=20`,
    role: 'admin',
  });
  const messageItems = getArrayFromPaths<Record<string, unknown>>(messages.data, [['data', 'data'], ['data']]);
  const firstMessage = messageItems[0];
  if (!firstMessage) throw new Error(`No se generó notification_message in_app en smoke para correlationId=${correlationId}`);
  const messageId = getString(firstMessage, ['id']);

  await request({ method: 'GET', path: `/operations/notifications/messages/${messageId}`, role: 'admin' });

  const customerNotifications = await request({
    method: 'GET',
    path: `/customers/${CUSTOMER_ID}/notifications?channel=in_app&from=${encodeURIComponent(startedAt)}&page=1&limit=50`,
    role: 'customer',
  });
  const customerItems = getArrayFromPaths<Record<string, unknown>>(customerNotifications.data, [['data', 'data'], ['data']]);
  const firstInApp = findById(customerItems, messageId) ?? customerItems[0];
  if (!firstInApp) throw new Error('No se generó notificación in_app visible para el cliente en smoke');
  const inAppMessageId = getString(firstInApp, ['id']);
  await request({ method: 'GET', path: `/customers/${CUSTOMER_ID}/notifications/unread-count`, role: 'customer' });
  await request({
    method: 'POST',
    path: `/customers/${CUSTOMER_ID}/notifications/${inAppMessageId}/read`,
    role: 'customer',
    idempotencyKey: uniqueKey('smoke-notification-read'),
  });
  await request({
    method: 'POST',
    path: `/customers/${CUSTOMER_ID}/notifications/read-all`,
    role: 'customer',
    idempotencyKey: uniqueKey('smoke-notification-read-all'),
  });
  await request({
    method: 'POST',
    path: `/customers/${CUSTOMER_ID}/device-tokens`,
    role: 'customer',
    idempotencyKey: uniqueKey('smoke-device-token'),
    body: { platform: 'web', token: uniqueKey('device-token'), deviceId: `smoke-web-${Date.now()}` },
  });
}

if (process.argv[1]?.endsWith('notifications.smoke.ts') || process.argv[1]?.endsWith('notifications.smoke.js')) {
  void runNotificationsSmoke();
}
