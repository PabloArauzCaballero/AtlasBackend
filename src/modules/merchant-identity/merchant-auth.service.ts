/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza controla quién puede operar el canal del comercio afiliado y deja evidencia de cada acceso.
 * @system implementa identidad del comercio, credenciales y ciclo de vida de sus usuarios.
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { accessTokenVerifyOptions } from '../../common/utils/auth/jwt-claims.util.js';
import { AuthService, isLoginPinChallenge } from '../auth/auth.service.js';
import { MerchantActorRepository } from '../auth/merchant-actor.repository.js';
import { MerchantAuthResponse } from './merchant-identity.types.js';
import { toMerchantUserProfile } from './merchant-users.service.js';

function decodeMerchantUserId(accessToken: string): string {
  const payload = jwt.verify(accessToken, env.JWT_ACCESS_TOKEN_SECRET, accessTokenVerifyOptions());
  if (typeof payload === 'string' || typeof payload.merchantUserId !== 'string') {
    throw new UnauthorizedException('El token emitido no corresponde a un usuario de comercio.');
  }
  return payload.merchantUserId;
}

/**
 * Sesión del usuario del comercio afiliado.
 *
 * Reutiliza `AuthService` entero —hash de contraseña, bloqueo por intentos fallidos, rotación y
 * revocación de refresh tokens, registro de intentos de login— porque un plano de autenticación
 * paralelo es un plano que envejece distinto: el día que se endurece el bloqueo por fuerza bruta,
 * o se corrige un fallo, hacerlo en un solo sitio es la diferencia entre arreglarlo y creer que se
 * arregló. Lo único propio de esta población es la tabla de identidad que la resuelve.
 */
@Injectable()
export class MerchantAuthService {
  constructor(
    private readonly authService: AuthService,
    private readonly merchantActorRepository: MerchantActorRepository,
  ) {}

  async login(input: {
    tenantId: string;
    email: string;
    password: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<MerchantAuthResponse> {
    const outcome = await this.authService.login({
      tenantId: input.tenantId,
      dto: { actorType: 'merchant_user', identifier: input.email, password: input.password },
      ip: input.ip,
      userAgent: input.userAgent,
    });

    // El desafío de PIN es exclusivo de super admins internos; un comercio nunca debería llegar
    // aquí. Si llegara, se corta: emitir una sesión a medias sería peor que fallar.
    if (isLoginPinChallenge(outcome)) {
      throw new UnauthorizedException('El canal del comercio no admite el desafío de PIN.');
    }

    const response = await this.buildAuthenticatedResponse(outcome);
    await this.merchantActorRepository.touchMerchantUserLogin(response.user.id);
    return response;
  }

  async refresh(input: { refreshToken: string; ip: string | null; userAgent: string | null }): Promise<MerchantAuthResponse> {
    const tokens = await this.authService.refresh(input);
    return this.buildAuthenticatedResponse(tokens);
  }

  logout(input: { refreshToken: string; allDevices: boolean }): Promise<{ loggedOut: boolean }> {
    return this.authService.logout(input);
  }

  /** Perfil del comercio autenticado, releído de la base: el token dice quién es, no cómo está. */
  async getProfile(merchantUserId: string): Promise<MerchantAuthResponse['user']> {
    const merchantUser = await this.merchantActorRepository.findMerchantUserById(merchantUserId);
    if (!merchantUser) {
      throw new UnauthorizedException('La identidad de comercio del token ya no existe.');
    }
    return toMerchantUserProfile(merchantUser);
  }

  private async buildAuthenticatedResponse(tokens: {
    accessToken: string;
    refreshToken: string;
    tokenType: 'Bearer';
    expiresIn: string;
  }): Promise<MerchantAuthResponse> {
    const merchantUserId = decodeMerchantUserId(tokens.accessToken);
    return { ...tokens, user: await this.getProfile(merchantUserId) };
  }
}
