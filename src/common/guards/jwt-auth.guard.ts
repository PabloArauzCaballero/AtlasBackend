import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { AuthenticatedUser, RequestWithAuth } from '../types/auth.types.js';

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

function assertAuthenticatedUser(payload: string | jwt.JwtPayload): AuthenticatedUser {
  if (typeof payload === 'string') {
    throw new UnauthorizedException('Payload JWT inválido.');
  }

  const role = payload.role;
  if (typeof payload.sub !== 'string' || typeof role !== 'string') {
    throw new UnauthorizedException('Payload JWT incompleto.');
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

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const token = extractBearerToken(request.headers.authorization);

    try {
      const payload = jwt.verify(token, env.JWT_ACCESS_TOKEN_SECRET, {
        algorithms: ['HS256'],
      });
      request.user = assertAuthenticatedUser(payload);
      return true;
    } catch (error: unknown) {
      throw new UnauthorizedException('Token inválido o expirado.');
    }
  }
}
