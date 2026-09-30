import { ServiceUnavailableException } from '@nestjs/common';
import { InternalMailController } from '../../../src/modules/notifications/internal-mail.controller.js';
import { internalMailSchema } from '../../../src/modules/notifications/internal-mail.schemas.js';

/** El ERP manda la propuesta por aquí: si el correo de ATLAS no es Gmail, se dice; no se finge. */
describe('InternalMailController', () => {
  const user = { sub: 'u-1', role: 'admin' } as never;
  const body = internalMailSchema.parse({
    to: 'Comercio@Multicenter.bo',
    subject: 'Propuesta comercial PROP-2026-000002 — ATLAS',
    text: 'Adjuntamos la propuesta.',
    reference: 'proposal:PROP-2026-000002',
    attachments: [{ filename: 'propuesta.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('%PDF').toString('base64') }],
  });

  it('manda por Gmail un correo por destinatario, con el PDF decodificado', async () => {
    const gmail = { isEnabled: () => true, sendEmail: jest.fn(async () => ({ id: 'gm-1', threadId: null, response: {} })) };
    const result = await new InternalMailController(gmail as never).send(body, user);
    expect(result).toEqual({ provider: 'gmail_api', messageId: 'gm-1' });
    expect(gmail.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['comercio@multicenter.bo'],
        boundarySeed: 'proposal:PROP-2026-000002',
        attachments: [{ filename: 'propuesta.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF') }],
      }),
    );
  });

  it('pasa el HTML, el nombre de quien envía y su correo para las respuestas', async () => {
    const gmail = { isEnabled: () => true, sendEmail: jest.fn(async () => ({ id: 'gm-2', threadId: null, response: {} })) };
    await new InternalMailController(gmail as never).send(
      internalMailSchema.parse({ ...body, html: '<p>Hola</p>', replyTo: 'Ana@Atlas.bo', fromName: 'Ana Pérez · ATLAS' }),
      user,
    );
    expect(gmail.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ html: '<p>Hola</p>', replyTo: 'ana@atlas.bo', fromName: 'Ana Pérez · ATLAS' }),
    );
  });

  it('sin Gmail como proveedor responde 503 y no manda nada', async () => {
    const gmail = { isEnabled: () => false, sendEmail: jest.fn() };
    await expect(new InternalMailController(gmail as never).send(body, user)).rejects.toThrow(ServiceUnavailableException);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it('sólo admite PDF como adjunto', () => {
    expect(
      internalMailSchema.safeParse({
        ...body,
        attachments: [{ filename: 'x.exe', contentType: 'application/octet-stream', contentBase64: 'AA==' }],
      }).success,
    ).toBe(false);
  });
});
