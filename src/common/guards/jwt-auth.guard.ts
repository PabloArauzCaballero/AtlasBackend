import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { TokenRevocationService } from '../services/token-revocation.service.js';
import { AuthenticatedUser, RequestWithAuth } from '../types/auth.types.js';

const KNOWN_ROLES: ReadonlySet<AuthenticatedUser['role']> = new Set([
  'customer',
  'internal_operator',
  'risk_analyst',
  'compliance_analyst',
  'fraud_analyst',
  'system',
  'system_admin',
  'qa_engineer',
  'devops',
  'readonly_auditor',
  'merchant',
  'admin',
  'platform_admin',
]);

function extractBearerToken(authorizationHeader: string | string[] | undefined): string {
  const header = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;

  if (!header) {
    throw new UnauthorizedException('Token Bearer requerido.');
  }

  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new UnauthorizedException('Formato de Authorization inválido. Use: Bearer <token>.');
  }

  return token;
}

// Devuelve `null` (en vez de lanzar una excepción con un mensaje específico) porque el único
// punto de llamada envuelve esto en un try/catch que siempre lanza el mismo mensaje genérico
// `'Token inválido o expirado.'` — no filtrar detalle sobre POR QUÉ el token es rechazado es
// deliberado (evita darle a un atacante pistas para distinguir "firma inválida" de "payload
// incompleto"). Antes esta función lanzaba `UnauthorizedException` con mensajes distintos por
// caso, pero como quedaban atrapados por ese catch, nunca llegaban al cliente: código muerto que
// además podía inducir a error a quien lo leyera (incluida documentación de API generada a partir
// de este archivo, que llegó a describir esos mensajes como parte del contrato real).
function parseAuthenticatedUser(payload: string | jwt.JwtPayload): AuthenticatedUser | null {
  if (typeof payload === 'string') {
    return null;
  }

  const role = payload.role;
  if (typeof payload.sub !== 'string' || typeof role !== 'string' || !KNOWN_ROLES.has(role as AuthenticatedUser['role'])) {
    return null;
  }

  return {
    sub: payload.sub,
    role: role as AuthenticatedUser['role'],
    tenantId: typeof payload.tenantId === 'string' ? payload.tenantId : undefined,
    customerId: typeof payload.customerId === 'string' ? payload.customerId : undefined,
    internalUserId: typeof payload.internalUserId === 'string' ? payload.internalUserId : undefined,
    platformUserId: typeof payload.platformUserId === 'string' ? payload.platformUserId : undefined,
    tokenVersion: typeof payload.tokenVersion === 'number' ? payload.tokenVersion : undefined,
  };
}

/**
 * Valida JWT y compara `tokenVersion` contra la versión vigente del actor.
 *
 * Los tokens de herramientas locales sin `tokenVersion` no activan este chequeo; los clientes
 * reales deben obtener tokens desde `POST /auth/login`.
 */
function actorLookup(user: AuthenticatedUser): { actorType: string; actorId: string } | null {
  if (user.customerId) return { actorType: 'customer', actorId: user.customerId };
  if (user.internalUserId) return { actorType: 'internal_user', actorId: user.internalUserId };
  if (user.platformUserId) return { actorType: 'platform_user', actorId: user.platformUserId };
  return null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenRevocationService: TokenRevocationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const token = extractBearerToken(request.headers.authorization);

    let payload: string | jwt.JwtPayload;
    try {
      payload = jwt.verify(token, env.JWT_ACCESS_TOKEN_SECRET, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('Token inválido o expirado.');
    }

    const user = parseAuthenticatedUser(payload);
    if (!user) {
      throw new UnauthorizedException('Token inválido o expirado.');
    }

    // Local smoke/dev tokens intentionally omit revocation metadata. They must
    // never be accepted by a production process.
    if (env.NODE_ENV === 'production' && (typeof user.tokenVersion !== 'number' || !actorLookup(user))) {
      throw new UnauthorizedException('Token invalido o expirado.');
    }

    if (typeof user.tokenVersion === 'number') {
      const actor = actorLookup(user);
      if (actor) {
        const currentVersion = await this.tokenRevocationService.getCurrentTokenVersion(actor.actorType, actor.actorId);
        if (currentVersion !== null && currentVersion !== user.tokenVersion) {
          throw new UnauthorizedException('Token revocado. Inicia sesión nuevamente.');
        }
      }
    }

    request.user = user;
    return true;
  }
}
