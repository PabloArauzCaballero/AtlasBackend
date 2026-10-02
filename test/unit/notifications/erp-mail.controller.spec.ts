import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { env } from '../../../src/config/env.js';
import { ErpMailController, ErpMailSignatureGuard } from '../../../src/modules/notifications/erp-mail.controller.js';
import { internalMailSchema } from '../../../src/modules/notifications/internal-mail.schemas.js';
import { SIGNATURE_HEADER, signEventBody } from '../../../src/platform/security/signed-event.js';

/**
 * La factura la entrega un WORKER del ERP, sin sesión: esta ruta sólo acepta la firma del ERP sobre el
 * cuerpo crudo. Antes no existía y el ERP mandaba por SendGrid, que no está contratado.
 */
const SECRETO = 'secreto-del-erp-con-al-menos-32-caracteres!!';
const cuerpo = JSON.stringify({
  to: 'comprador@example.com',
  subject: 'Su factura N° 123',
  text: 'Adjuntamos su factura.',
  reference: 'siat:doc-1:EMISION',
  attachments: [{ filename: 'factura-123.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('%PDF').toString('base64') }],
});

function contexto(headers: Record<string, string>, raw = cuerpo) {
  return { switchToHttp: () => ({ getRequest: () => ({ headers, rawBody: Buffer.from(raw) }) }) } as never;
}

describe('ErpMailSignatureGuard', () => {
  const original = env.ERP_EVENTS_SIGNING_SECRET;
  afterEach(() => {
    (env as { ERP_EVENTS_SIGNING_SECRET?: string }).ERP_EVENTS_SIGNING_SECRET = original;
  });
  const conSecreto = () => ((env as { ERP_EVENTS_SIGNING_SECRET?: string }).ERP_EVENTS_SIGNING_SECRET = SECRETO);
  const ahora = () => Math.floor(Date.now() / 1000);

  it('sin secreto configurado la ruta está CERRADA (503), no abierta', () => {
    (env as { ERP_EVENTS_SIGNING_SECRET?: string }).ERP_EVENTS_SIGNING_SECRET = undefined;
    expect(() => new ErpMailSignatureGuard().canActivate(contexto({}))).toThrow(ServiceUnavailableException);
  });

  it('acepta el cuerpo firmado por el ERP', () => {
    conSecreto();
    const firma = signEventBody(SECRETO, cuerpo, ahora());
    expect(new ErpMailSignatureGuard().canActivate(contexto({ [SIGNATURE_HEADER]: firma }))).toBe(true);
  });

  it('rechaza sin firma, con otro secreto o con el cuerpo alterado', () => {
    conSecreto();
    const guard = new ErpMailSignatureGuard();
    expect(() => guard.canActivate(contexto({}))).toThrow(UnauthorizedException);
    expect(() =>
      guard.canActivate(contexto({ [SIGNATURE_HEADER]: signEventBody('otro-secreto-de-32-caracteres-o-mas!!', cuerpo, ahora()) })),
    ).toThrow(UnauthorizedException);
    const firma = signEventBody(SECRETO, cuerpo, ahora());
    expect(() => guard.canActivate(contexto({ [SIGNATURE_HEADER]: firma }, cuerpo.replace('comprador', 'atacante')))).toThrow(
      UnauthorizedException,
    );
  });
});

describe('ErpMailController', () => {
  it('manda por Gmail con el PDF decodificado', async () => {
    const gmail = { isEnabled: () => true, sendEmail: jest.fn(async () => ({ id: 'gm-9', threadId: null, response: {} })) };
    const result = await new ErpMailController(gmail as never).send(internalMailSchema.parse(JSON.parse(cuerpo)));
    expect(result).toEqual({ provider: 'gmail_api', messageId: 'gm-9' });
    expect(gmail.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['comprador@example.com'], attachments: [expect.objectContaining({ content: Buffer.from('%PDF') })] }),
    );
  });

  it('sin Gmail como proveedor responde 503: el ERP reintenta, no da el correo por enviado', async () => {
    const gmail = { isEnabled: () => false, sendEmail: jest.fn() };
    await expect(new ErpMailController(gmail as never).send(internalMailSchema.parse(JSON.parse(cuerpo)))).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
