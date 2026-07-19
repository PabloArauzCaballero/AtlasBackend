import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { env } from '../../../src/config/env.js';
import { MailSenderClient, MailSenderDeliveryError } from '../../../src/modules/mail-sender/mail-sender.client.js';
import { MAIL_TEMPLATE_DEFINITIONS } from '../../../src/modules/mail-sender/mail-sender.templates.js';

/**
 * Cobertura directa de `MailSenderClient` (Fase 1.2): el conector HTTP real hacia el microservicio
 * MailSender. Lógica no trivial: token administrativo cacheado, resolución/auto-provisión idempotente
 * de plantillas por nombre, reintento único ante 401, y el envío. `env` (plano, no congelado) se
 * configura por test y se restaura; el executor resiliente se mockea (resolver=HTTP ok segun status,
 * rechazar=fallo, igual que callResilient traduce).
 */
describe('MailSenderClient', () => {
  const CONFIG: Record<string, string> = {
    MAILSENDER_BASE_URL: 'https://mail.example/',
    MAILSENDER_EXTERNAL_API_KEY: 'api-key',
    MAILSENDER_ADMIN_USERNAME: 'admin',
    MAILSENDER_ADMIN_PASSWORD: 'pw',
    MAILSENDER_API_PREFIX: '/api',
  };
  const keys = Object.keys(CONFIG);
  const saved: Record<string, unknown> = {};

  beforeEach(() => {
    for (const k of keys) saved[k] = (env as Record<string, unknown>)[k];
  });
  afterEach(() => {
    for (const k of keys) (env as Record<string, unknown>)[k] = saved[k];
  });

  const configure = () => {
    for (const k of keys) (env as Record<string, unknown>)[k] = CONFIG[k];
  };
  const build = () => {
    const executor = { run: jest.fn() };
    return { client: new MailSenderClient(executor as never), executor };
  };
  const input = {
    template: 'atlas-password-reset' as const,
    to: 'user@example.com',
    recipientName: 'User',
    sourceModule: 'auth',
    reference: 'ref-1',
    variables: { code: '123456' },
  };
  const definitionName = MAIL_TEMPLATE_DEFINITIONS['atlas-password-reset'].nombre;

  it('isConfigured refleja la presencia de las 4 variables de entorno', () => {
    (env as Record<string, unknown>).MAILSENDER_BASE_URL = undefined;
    expect(build().client.isConfigured()).toBe(false);
    configure();
    expect(build().client.isConfigured()).toBe(true);
  });

  it('sin configurar, sendTemplateEmail lanza ServiceUnavailable sin tocar la red', async () => {
    (env as Record<string, unknown>).MAILSENDER_BASE_URL = undefined;
    const { client, executor } = build();
    await expect(client.sendTemplateEmail(input)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(executor.run).not.toHaveBeenCalled();
  });

  it('happy path: token admin -> auto-provisiona la plantilla -> envía y devuelve trackingId', async () => {
    configure();
    const { client, executor } = build();
    (executor.run as jest.Mock)
      .mockResolvedValueOnce({ status: 200, json: { data: { accessToken: 'tok' } } } as never) // /auth/token
      .mockResolvedValueOnce({ status: 200, json: { data: [] } } as never) // GET /templates -> vacío
      .mockResolvedValueOnce({ status: 201, json: { data: { id: 'tpl-1' } } } as never) // POST /templates (crear)
      .mockResolvedValueOnce({ status: 200, json: { data: { trackingId: 'trk-1' } } } as never); // POST /messages/send
    const res = await client.sendTemplateEmail(input);
    expect(res).toEqual({ trackingId: 'trk-1' });
    expect(executor.run).toHaveBeenCalledTimes(4);
  });

  it('reutiliza la plantilla cacheada: el 2º envío no vuelve a resolver token/plantilla', async () => {
    configure();
    const { client, executor } = build();
    (executor.run as jest.Mock)
      .mockResolvedValueOnce({ status: 200, json: { data: { accessToken: 'tok' } } } as never)
      .mockResolvedValueOnce({ status: 200, json: { data: [{ nombre: definitionName, id: 'tpl-existing' }] } } as never) // existe -> no crea
      .mockResolvedValueOnce({ status: 200, json: { data: { trackingId: 't1' } } } as never)
      .mockResolvedValueOnce({ status: 200, json: { data: { trackingId: 't2' } } } as never); // 2º send, plantilla cacheada
    await client.sendTemplateEmail(input);
    const before = (executor.run as jest.Mock).mock.calls.length;
    await client.sendTemplateEmail(input);
    expect((executor.run as jest.Mock).mock.calls.length).toBe(before + 1); // solo el send
  });

  it('reintenta una vez con token fresco cuando MailSender responde 401 al listar plantillas', async () => {
    configure();
    const { client, executor } = build();
    (executor.run as jest.Mock)
      .mockResolvedValueOnce({ status: 200, json: { data: { accessToken: 'tok1' } } } as never) // /auth/token
      .mockResolvedValueOnce({ status: 401, json: {} } as never) // list -> 401
      .mockResolvedValueOnce({ status: 200, json: { data: { accessToken: 'tok2' } } } as never) // /auth/token refetch
      .mockResolvedValueOnce({ status: 200, json: { data: [{ nombre: definitionName, id: 'tpl-r' }] } } as never) // list retry OK
      .mockResolvedValueOnce({ status: 200, json: { data: { trackingId: 'trk-r' } } } as never); // send
    const res = await client.sendTemplateEmail(input);
    expect(res).toEqual({ trackingId: 'trk-r' });
    expect(executor.run).toHaveBeenCalledTimes(5);
  });

  it('propaga MAILSENDER_AUTH_FAILED cuando el token admin no se emite', async () => {
    configure();
    const { client, executor } = build();
    (executor.run as jest.Mock).mockRejectedValueOnce(new Error('boom') as never); // /auth/token falla
    await expect(client.sendTemplateEmail(input)).rejects.toMatchObject({ code: 'MAILSENDER_AUTH_FAILED' });
  });

  it('propaga MAILSENDER_SEND_FAILED cuando el envío falla', async () => {
    configure();
    const { client, executor } = build();
    (executor.run as jest.Mock)
      .mockResolvedValueOnce({ status: 200, json: { data: { accessToken: 'tok' } } } as never)
      .mockResolvedValueOnce({ status: 200, json: { data: [{ nombre: definitionName, id: 'tpl-1' }] } } as never)
      .mockRejectedValueOnce(new Error('send boom') as never); // /messages/send falla
    await expect(client.sendTemplateEmail(input)).rejects.toBeInstanceOf(MailSenderDeliveryError);
  });
});
