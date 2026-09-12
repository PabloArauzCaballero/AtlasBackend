import { describe, expect, it, jest } from '@jest/globals';
import { GmailMailTransport } from '../../../src/modules/mail-sender/gmail-mail.transport.js';
import { MailTemplateRenderError } from '../../../src/modules/mail-sender/mail-template-render.js';

/**
 * El transporte por Gmail rinde en local las mismas plantillas que MailSender hospeda. Lo que se
 * verifica aquí es justo lo que MailSender hacía por nosotros y ahora es responsabilidad propia:
 * que las variables entren, que ninguna se quede sin sustituir y que el asunto sea el de la
 * plantilla y no uno inventado.
 */
describe('GmailMailTransport', () => {
  function build(enabled = true) {
    const gmail = {
      isEnabled: jest.fn((..._args: unknown[]) => enabled),
      sendEmail: jest.fn(async (..._args: unknown[]) => ({ id: 'gmail-msg-1', threadId: null, response: {} })),
    };
    return { transport: new GmailMailTransport(gmail as never), gmail };
  }

  it('sólo se considera configurado si Gmail es el proveedor elegido', () => {
    expect(build(true).transport.isConfigured()).toBe(true);
    expect(build(false).transport.isConfigured()).toBe(false);
  });

  it('rinde asunto, texto y HTML de la plantilla con las variables entregadas', async () => {
    const { transport, gmail } = build();
    const result = await transport.sendTemplateEmail({
      template: 'atlas-login-pin',
      to: 'ana@comercioalfa.bo',
      recipientName: 'Ana',
      sourceModule: 'auth',
      reference: 'login-pin-internal_user-10',
      variables: { nombre: 'Ana', pin: '482913', minutos: '10', producto: 'ERP corporativo' },
    });

    expect(result).toEqual({ trackingId: 'gmail-msg-1' });
    const [sent] = gmail.sendEmail.mock.calls[0] as [{ to: string[]; subject: string; text: string; html: string }];
    expect(sent.to).toEqual(['ana@comercioalfa.bo']);
    expect(sent.subject).toBe('ATLAS — Tu PIN de acceso');
    expect(sent.text).toContain('482913');
    expect(sent.html).toContain('482913');
    expect(sent.text).toContain('Ana');
    // Ni un hueco sin rellenar: un `{{pin}}` literal es un correo entregado y un PIN inservible.
    expect(sent.text).not.toContain('{{');
    expect(sent.html).not.toContain('{{');
  });

  it('rechaza el envío si falta una variable exigida por la plantilla', async () => {
    const { transport, gmail } = build();
    await expect(
      transport.sendTemplateEmail({
        template: 'atlas-login-pin',
        to: 'ana@comercioalfa.bo',
        recipientName: 'Ana',
        sourceModule: 'auth',
        reference: 'r',
        variables: { nombre: 'Ana', minutos: '10', producto: 'ERP corporativo' },
      }),
    ).rejects.toBeInstanceOf(MailTemplateRenderError);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  /** Sin id de Gmail queda la referencia de origen: siempre hay con qué correlacionar el envío. */
  it('cae en la referencia de origen cuando Gmail no devuelve id', async () => {
    const { transport, gmail } = build();
    gmail.sendEmail.mockResolvedValueOnce({ id: null, threadId: null, response: {} } as never);
    const result = await transport.sendTemplateEmail({
      template: 'atlas-password-reset',
      to: 'ana@comercioalfa.bo',
      recipientName: null,
      sourceModule: 'auth',
      reference: 'reset-42',
      variables: { nombre: 'Usuario ATLAS', codigo: '123456', minutos: '10', producto: 'ERP corporativo' },
    });
    expect(result).toEqual({ trackingId: 'reset-42' });
  });
});
