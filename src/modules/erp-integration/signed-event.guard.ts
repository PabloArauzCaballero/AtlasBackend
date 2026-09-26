/**
 * @file Guard de eventos firmados entre servicios (P-14): la regla de autorización del receptor S2S.
 * @business Sólo el ERP, con el secreto de ESTE sentido y una firma reciente, entrega hechos de dinero
 *   a Core. Sin secreto configurado la ruta no existe (503) y el ERP reintenta: cerrada, nunca abierta.
 * @system Lee `@SignedEventSource(productor)` del handler/clase y verifica `x-atlas-signature` sobre el
 *   cuerpo CRUDO (`request.rawBody`, que `main.ts` conserva sólo para estas rutas). Se combina con
 *   `@Public()` porque el guard global de sesión no entiende firmas de servicio (otra audiencia).
 */
import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { env } from '../../config/env.js';
import { SIGNATURE_HEADER, verifyEventSignature } from '../../platform/security/signed-event.js';

export const SIGNED_EVENT_SOURCE_KEY = 'atlas.signedEventSource';
export type SignedEventProducer = 'atlas-erp';

/** Regla de autorización: qué productor firma las peticiones de esta ruta. */
export const SignedEventSource = (producer: SignedEventProducer): MethodDecorator & ClassDecorator =>
  SetMetadata(SIGNED_EVENT_SOURCE_KEY, producer);

/** Secreto con el que se verifica cada productor. Uno por sentido. */
function secretFor(producer: SignedEventProducer): string | undefined {
  return producer === 'atlas-erp' ? env.ERP_EVENTS_SIGNING_SECRET : undefined;
}

export type RequestWithRawBody = {
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
  signedEventProducer?: SignedEventProducer;
};

@Injectable()
export class SignedEventGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const producer = this.reflector.getAllAndOverride<SignedEventProducer | undefined>(SIGNED_EVENT_SOURCE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!producer) throw new UnauthorizedException('SIGNED_EVENT_SOURCE_UNDECLARED');
    const secret = secretFor(producer);
    if (!secret) throw new ServiceUnavailableException('SIGNED_EVENTS_NOT_CONFIGURED');
    const request = context.switchToHttp().getRequest<RequestWithRawBody>();
    if (!request.rawBody) throw new BadRequestException('RAW_JSON_BODY_REQUIRED');
    const header = request.headers[SIGNATURE_HEADER];
    const verdict = verifyEventSignature({
      secret,
      header: Array.isArray(header) ? header[0] : header,
      rawBody: request.rawBody.toString('utf8'),
      toleranceSeconds: env.ERP_EVENTS_SIGNATURE_TOLERANCE_SECONDS,
    });
    if (!verdict.ok) throw new UnauthorizedException(`SIGNATURE_${verdict.reason}`);
    request.signedEventProducer = producer;
    return true;
  }
}
