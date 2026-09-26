/**
 * @file Guard de identidad de servicio entre contextos (AT-047/AT-057).
 * @business Una ruta interna entre contextos sólo la usa un servicio conocido, con el permiso declarado
 *   por la ruta y para el tenant que viaja en su token. Sin secreto configurado, la ruta no existe (503).
 * @system Lee `@ServiceScope(scope, contexto, servicios)` del handler/clase, verifica el Bearer con
 *   `verifyServiceToken` y deja `request.serviceActor` para el controlador. Se combina con `@Public()`
 *   porque el guard global de sesión no debe evaluar estos tokens (otra audiencia).
 */
import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { env } from '../../config/env.js';
import { verifyServiceToken, type ServiceTokenClaims } from '../../platform/security/service-token.js';

export const SERVICE_SCOPE_KEY = 'atlas.serviceScope';
export type ServiceScopeRule = Readonly<{
  scope: string;
  audienceContext: string;
  allowedServices: readonly string[];
  /** Si está, el token tiene que venir firmado para ESTE recurso (revisión independiente A, hallazgo 7). */
  resourceFrom?: (query: Readonly<Record<string, unknown>>) => string;
}>;

/** Regla de autorización de servicio: contexto que sirve (audiencia), permiso exigido y servicios admitidos. */
export const ServiceScope = (
  scope: string,
  audienceContext: string,
  allowedServices: readonly string[],
  resourceFrom?: ServiceScopeRule['resourceFrom'],
): MethodDecorator & ClassDecorator =>
  SetMetadata<string, ServiceScopeRule>(SERVICE_SCOPE_KEY, Object.freeze({ scope, audienceContext, allowedServices, resourceFrom }));

export type RequestWithServiceActor = {
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  serviceActor?: ServiceTokenClaims;
};

@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const rule = this.reflector.getAllAndOverride<ServiceScopeRule | undefined>(SERVICE_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) throw new UnauthorizedException('SERVICE_SCOPE_UNDECLARED');
    if (!env.CONTEXT_SERVICE_TOKEN_SECRET) throw new ServiceUnavailableException('SERVICE_TOKENS_DISABLED');
    const request = context.switchToHttp().getRequest<RequestWithServiceActor>();
    const header = request.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    const [scheme, token] = (value ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('SERVICE_TOKEN_REQUIRED');
    const resource = rule.resourceFrom ? rule.resourceFrom(request.query ?? {}) : undefined;
    const verification = verifyServiceToken(token, { ...rule, resource });
    if (!verification.ok) throw new UnauthorizedException(verification.reason.split(':')[0]);
    request.serviceActor = verification.claims;
    return true;
  }
}
