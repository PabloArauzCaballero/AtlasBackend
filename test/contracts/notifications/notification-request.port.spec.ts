/**
 * @file AT-017 — contrato del puerto de solicitud de notificación con el adaptador local.
 * @business Quien pide un aviso recibe un identificador estable y un estado; nunca un modelo con
 *   `.save()`; repetir la misma clave produce el mismo efecto lógico; un tenant ausente o un canal
 *   no permitido se deniegan, no se degradan en silencio.
 * @system Adaptador real con un doble del repositorio (la deduplicación por clave es del repositorio
 *   y se prueba con PostgreSQL en sus propias pruebas).
 */
import { describe, expect, it, jest } from '@jest/globals';
import { LocalNotificationRequestAdapter } from '../../../src/modules/notifications/infrastructure/local-notification-request.adapter.js';
import { ApplicationError } from '../../../src/platform/contracts/application-error.js';

function build() {
  const store = new Map<string, { id: string; status: string }>();
  let sequence = 1;
  const repository = {
    findByIdempotencyKey: jest.fn(async (_tenant: string | null, key: string) => store.get(key) ?? null),
    createMessage: jest.fn(async (input: { idempotencyKey?: string | null }) => {
      const message = { id: String(sequence++), status: 'pending', save: () => undefined };
      if (input.idempotencyKey) store.set(input.idempotencyKey, message);
      return message;
    }),
  };
  return { adapter: new LocalNotificationRequestAdapter(repository as never), repository };
}

const input = {
  recipient: { type: 'customer' as const, id: '42' },
  channel: 'in_app' as const,
  templateCode: null,
  title: 'Hola',
  body: 'Tu solicitud fue recibida',
  payload: { applicationCode: 'CRA-1' },
};
const context = { tenantId: '1', correlationId: 'c-1' };

describe('NotificationRequestPort · adaptador local', () => {
  it('un mensaje válido devuelve un identificador estable y sólo valores (sin save)', async () => {
    const { adapter, repository } = build();
    const result = await adapter.request(input, context);
    expect(result).toEqual({ notificationId: '1', accepted: true, status: 'pending', deduplicated: false });
    expect(Object.isFrozen(result)).toBe(true);
    expect('save' in result).toBe(false);
    expect(repository.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: '1', recipientType: 'customer', recipientId: '42', channel: 'in_app', correlationId: 'c-1' }),
    );
  });

  it('reintento con la misma clave de deduplicación: mismo identificador, efecto lógico único', async () => {
    const { adapter, repository } = build();
    const first = await adapter.request({ ...input, dedupKey: 'welcome:42' }, context);
    const second = await adapter.request({ ...input, dedupKey: 'welcome:42' }, context);
    expect(second.notificationId).toBe(first.notificationId);
    expect(second.deduplicated).toBe(true);
    expect(repository.createMessage).toHaveBeenCalledTimes(1);
  });

  it('sin tenant en el contexto: denegación, no fallback silencioso', async () => {
    const { adapter, repository } = build();
    await expect(adapter.request(input, { tenantId: '', correlationId: null })).rejects.toThrow(ApplicationError);
    expect(repository.createMessage).not.toHaveBeenCalled();
  });

  it('canal no permitido o destinatario inválido: denegación con código', async () => {
    const { adapter } = build();
    await expect(adapter.request({ ...input, channel: 'fax' as never }, context)).rejects.toMatchObject({
      code: 'NOTIFICATION_CHANNEL_NOT_ALLOWED',
    });
    await expect(adapter.request({ ...input, recipient: { type: 'customer', id: '' } }, context)).rejects.toMatchObject({
      code: 'NOTIFICATION_RECIPIENT_INVALID',
    });
  });

  it('el contrato público no filtra implementación: sólo tipos, constantes y el token', async () => {
    const publicApi = await import('../../../src/modules/notifications/public/index.js');
    expect(Object.keys(publicApi).sort()).toEqual(['NOTIFICATION_CHANNELS', 'NOTIFICATION_RECIPIENT_TYPES', 'NOTIFICATION_REQUEST_PORT']);
  });
});
