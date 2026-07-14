import { Injectable, UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AuthService, LoginPinChallenge, isLoginPinChallenge } from '../auth/auth.service.js';
import { InternalUsersService } from './internal-users.service.js';
import { InternalAuthResponse } from './internal-users.types.js';

function decodeInternalUserId(accessToken: string): { tenantId: string; internalUserId: string } {
  const payload = jwt.verify(accessToken, env.JWT_ACCESS_TOKEN_SECRET, { algorithms: ['HS256'] });
  if (typeof payload === 'string' || typeof payload.tenantId !== 'string' || typeof payload.internalUserId !== 'string') {
    throw new UnauthorizedException('El token emitido no corresponde a un usuario interno.');
  }

  return { tenantId: payload.tenantId, internalUserId: payload.internalUserId };
}

@Injectable()
export class InternalAuthService {
  constructor(
    private readonly authService: AuthService,
    private readonly internalUsersService: InternalUsersService,
  ) {}

  async login(input: {
    tenantId: string;
    email: string;
    password: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<InternalAuthResponse | LoginPinChallenge> {
    const outcome = await this.authService.login({
      tenantId: input.tenantId,
      dto: { actorType: 'internal_user', identifier: input.email, password: input.password },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    // Super admin con MailSender configurado: el panel debe pedir el PIN recibido por correo y
    // completar el login vía `verifyLoginPin` — todavía no hay tokens que decodificar.
    if (isLoginPinChallenge(outcome)) return outcome;
    return this.buildAuthenticatedResponse(outcome);
  }

  async verifyLoginPin(input: {
    challengeToken: string;
    pin: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<InternalAuthResponse> {
    const tokens = await this.authService.verifyLoginPin(input);
    return this.buildAuthenticatedResponse(tokens);
  }

  async refresh(input: { refreshToken: string; ip: string | null; userAgent: string | null }): Promise<InternalAuthResponse> {
    const tokens = await this.authService.refresh({ refreshToken: input.refreshToken, ip: input.ip, userAgent: input.userAgent });
    return this.buildAuthenticatedResponse(tokens);
  }

  private async buildAuthenticatedResponse(tokens: {
    accessToken: string;
    refreshToken: string;
    tokenType: 'Bearer';
    expiresIn: string;
  }): Promise<InternalAuthResponse> {
    const actor = decodeInternalUserId(tokens.accessToken);
    const profile = await this.internalUsersService.getMyProfile({
      sub: actor.internalUserId,
      tenantId: actor.tenantId,
      internalUserId: actor.internalUserId,
      role: 'internal_operator',
    });

    return { ...tokens, ...profile };
  }

  logout(input: { refreshToken: string; allDevices: boolean }): Promise<{ loggedOut: boolean }> {
    return this.authService.logout(input);
  }
}
