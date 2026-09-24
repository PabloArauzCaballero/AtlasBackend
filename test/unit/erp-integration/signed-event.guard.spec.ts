/**
 * @file P-14 — guard del receptor S2S: firma HMAC sobre el cuerpo crudo y ventana anti-replay.
 * @business Nadie sin el secreto del ERP entrega hechos de dinero a Core; una firma capturada no se
 *   puede repetir pasada la ventana; sin secreto configurado la ruta está cerrada (503), no abierta.
 * @system Contexto de ejecución de mentira con el decorador real del controlador.
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import { BadRequestException, ServiceUnavailableException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { env } from '../../../src/config/env.js';
import { IS_PUBLIC_KEY } from '../../../src/common/decorators/public.decorator.js';
import { ErpEventsController } from '../../../src/modules/erp-integration/erp-events.controller.js';
import { SIGNED_EVENT_SOURCE_KEY, SignedEventGuard } from '../../../src/modules/erp-integration/signed-event.guard.js';
import { signEventBody } from '../../../src/platform/security/signed-event.js';

const SECRET = 'erp-a-core-secreto-de-al-menos-32-caracteres';
const mutableEnv = env as unknown as Record<string, unknown>;
const original = mutableEnv.ERP_EVENTS_SIGNING_SECRET;

afterEach(() => {
  mutableEnv.ERP_EVENTS_SIGNING_SECRET = original;
});

function contextFor(
  request: Record<string, unknown>,
  target: { handler: unknown; cls: unknown } = { handler: ErpEventsController.prototype.receive, cls: ErpEventsController },
): ExecutionContext {
  return {
    getHandler: () => target.handler,
    getClass: () => target.cls,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const body = '{"eventKey":"k-1","topic":"b2b.coverage.settled"}';
const now = () => Math.floor(Date.now() / 1000);

describe('SignedEventGuard', () => {
  const guard = new SignedEventGuard(new Reflector());

  it('el receptor es público para la SESIÓN pero declara al ERP como único firmante', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, ErpEventsController)).toBe(true);
    expect(Reflect.getMetadata(SIGNED_EVENT_SOURCE_KEY, ErpEventsController)).toBe('atlas-erp');
  });

  it('acepta una firma válida y reciente sobre el cuerpo crudo', () => {
    mutableEnv.ERP_EVENTS_SIGNING_SECRET = SECRET;
    const request: Record<string, unknown> = {
      headers: { 'x-atlas-signature': signEventBody(SECRET, body, now()) },
      rawBody: Buffer.from(body),
    };
    expect(guard.canActivate(contextFor(request))).toBe(true);
    expect(request.signedEventProducer).toBe('atlas-erp');
  });

  it('rechaza firma ausente, de otro secreto, sobre otro cuerpo o fuera de ventana (401)', () => {
    mutableEnv.ERP_EVENTS_SIGNING_SECRET = SECRET;
    const cases: Array<[string | undefined, string, RegExp]> = [
      [undefined, body, /SIGNATURE_MISSING/u],
      ['t=1,v1=zz', body, /SIGNATURE_MALFORMED/u],
      [signEventBody('otro-secreto-de-al-menos-32-caracteres!!', body, now()), body, /SIGNATURE_MISMATCH/u],
      [signEventBody(SECRET, body, now()), `${body} `, /SIGNATURE_MISMATCH/u],
      [signEventBody(SECRET, body, now() - 3_600), body, /SIGNATURE_EXPIRED/u],
    ];
    for (const [header, raw, reason] of cases) {
      expect(() => guard.canActivate(contextFor({ headers: { 'x-atlas-signature': header }, rawBody: Buffer.from(raw) }))).toThrow(reason);
    }
    expect(() => guard.canActivate(contextFor({ headers: {}, rawBody: Buffer.from(body) }))).toThrow(UnauthorizedException);
  });

  it('sin secreto configurado responde 503: la ruta está cerrada, no abierta', () => {
    mutableEnv.ERP_EVENTS_SIGNING_SECRET = undefined;
    expect(() => guard.canActivate(contextFor({ headers: {}, rawBody: Buffer.from(body) }))).toThrow(ServiceUnavailableException);
  });

  it('sin cuerpo crudo (no JSON) es 400 y sin productor declarado es 401', () => {
    mutableEnv.ERP_EVENTS_SIGNING_SECRET = SECRET;
    expect(() => guard.canActivate(contextFor({ headers: { 'x-atlas-signature': 'x' } }))).toThrow(BadRequestException);
    class Undeclared {
      handle(): void {}
    }
    expect(() => guard.canActivate(contextFor({ headers: {} }, { handler: Undeclared.prototype.handle, cls: Undeclared }))).toThrow(
      'SIGNED_EVENT_SOURCE_UNDECLARED',
    );
  });

  it('acepta la cabecera repetida tomando la primera', () => {
    mutableEnv.ERP_EVENTS_SIGNING_SECRET = SECRET;
    const request = { headers: { 'x-atlas-signature': [signEventBody(SECRET, body, now()), 'otra'] }, rawBody: Buffer.from(body) };
    expect(guard.canActivate(contextFor(request))).toBe(true);
  });
});
