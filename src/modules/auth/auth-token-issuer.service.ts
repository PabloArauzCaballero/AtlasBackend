/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza controla quién entra al sistema y con qué credenciales vigentes.
 * @system emite y rota los tokens de acceso y de refresco de cada actor autenticado.
 */
import { Injectable } from '@nestjs/common';
import jwt, { SignOptions } from 'jsonwebtoken';
import { Transaction } from 'sequelize';
import { env } from '../../config/env.js';
import { accessTokenSignOptions, actorIdClaim } from '../../common/utils/auth/jwt-claims.util.js';
import { generateRefreshToken, hashRefreshToken } from '../../common/utils/crypto/refresh-token.util.js';
import { ActorType, AuthRepository } from './auth.repository.js';
import { ResolvedActor } from './auth-actor-resolver.service.js';
import { LoginResponseDto } from './auth.dtos.js';

/**
 * Emisión de credenciales de sesión: el JWT de acceso y el refresh token que lo renueva.
 *
 * Vive aparte de `AuthService` porque ya no lo usa solo el login: el registro de un cliente abre su
 * propia sesión dentro de la MISMA transacción del alta, y el refresco la rota. Al estar aquí, las
 * tres rutas emiten con idéntico algoritmo, vigencia y forma de claims — que es justo lo que no se
 * puede permitir que divergiera.
 */
@Injectable()
export class AuthTokenIssuerService {
  constructor(private readonly authRepository: AuthRepository) {}

  issueAccessToken(actor: ResolvedActor, actorType: ActorType, tokenVersion: number): string {
    const payload: Record<string, unknown> = {
      sub: actor.id,
      role: actor.role,
      tokenVersion,
      ...(actor.tenantId ? { tenantId: actor.tenantId } : {}),
      ...actorIdClaim(actorType, actor.id),
    };

    const options: SignOptions = accessTokenSignOptions({
      algorithm: 'HS256',
      expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN as SignOptions['expiresIn'],
    });

    return jwt.sign(payload, env.JWT_ACCESS_TOKEN_SECRET, options);
  }

  async issueRefreshToken(
    input: {
      tenantId: string | null;
      actorType: ActorType;
      actorId: string;
      userAgent: string | null;
      ipAddress: string | null;
    },
    options: { transaction?: Transaction } = {},
  ): Promise<{ token: string; id: string }> {
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + env.AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000);
    const created = await this.authRepository.createRefreshToken(
      {
        tenantId: input.tenantId,
        actorType: input.actorType,
        actorId: input.actorId,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
      },
      options,
    );
    return { token: refreshToken, id: created.id };
  }

  async issueTokenPair(
    actor: ResolvedActor,
    actorType: ActorType,
    tokenVersion: number,
    network: { ip: string | null; userAgent: string | null },
  ): Promise<LoginResponseDto> {
    const accessToken = this.issueAccessToken(actor, actorType, tokenVersion);
    const issuedRefreshToken = await this.issueRefreshToken({
      tenantId: actor.tenantId,
      actorType,
      actorId: actor.id,
      userAgent: network.userAgent,
      ipAddress: network.ip,
    });

    return { accessToken, refreshToken: issuedRefreshToken.token, tokenType: 'Bearer', expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN };
  }

  /**
   * Tokens de la sesión que abre el propio registro.
   *
   * Existe porque `POST /customer-onboarding/start` creaba al cliente y sus credenciales pero no
   * devolvía ninguna credencial de sesión: el paso siguiente del flujo —verificar el contacto— está
   * detrás de `JwtAuthGuard`, así que el cliente recién registrado tenía que volver a
   * `POST /auth/login` con la contraseña que acababa de elegir para poder continuar. El registro
   * YA probó la identidad de quien está del otro lado (es quien fijó la contraseña en este mismo
   * request); pedirla otra vez no agrega seguridad, solo un paso que la app tenía que inventar.
   *
   * Se emite dentro de la MISMA transacción del registro: si el alta se deshace, el refresh token
   * emitido se deshace con ella y no queda una credencial válida apuntando a un cliente inexistente.
   */
  async issueRegistrationTokens(input: {
    tenantId: string;
    customerId: string;
    tokenVersion: number;
    ipAddress: string | null;
    userAgent: string | null;
    transaction?: Transaction;
  }): Promise<LoginResponseDto> {
    const actor: ResolvedActor = {
      id: input.customerId,
      tenantId: input.tenantId,
      role: 'customer',
      email: null,
      displayName: null,
    };
    const accessToken = this.issueAccessToken(actor, 'customer', input.tokenVersion);
    const issuedRefreshToken = await this.issueRefreshToken(
      {
        tenantId: input.tenantId,
        actorType: 'customer',
        actorId: input.customerId,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
      },
      { transaction: input.transaction },
    );
    return { accessToken, refreshToken: issuedRefreshToken.token, tokenType: 'Bearer', expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN };
  }
}
