/**
 * @file Servicio de aplicación: rotación transaccional del refresh token.
 * @business Esta pieza protege el acceso de clientes y operadores, la recuperación de cuenta y la continuidad segura de sesiones.
 * @system resuelve actores, credenciales, JWT, códigos de un solo uso y rotación/revocación de refresh tokens.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { hashRefreshToken } from '../../common/utils/crypto/refresh-token.util.js';
import { AuthActorResolverService } from './auth-actor-resolver.service.js';
import { AuthRefreshTokensRepository } from './auth-refresh-tokens.repository.js';
import { AuthTokenIssuerService } from './auth-token-issuer.service.js';
import { ActorType } from './auth-vocabulary.js';
import { AuthCredentialRepository } from './auth-credential.repository.js';
import {
  SESSION_EXPIRED_REVOKE_REASON,
  hasAbsoluteSessionCap,
  isCustomerSessionExpired,
  sessionStartOf,
} from './customer-session-lifetime.js';

export type RefreshInput = { ip: string | null; userAgent: string | null; expectedActorType?: ActorType };

export type RefreshOutcome =
  | { kind: 'success'; accessToken: string; refreshToken: string; expiresIn: string }
  | { kind: 'session_expired' }
  | { kind: 'invalid' }
  | { kind: 'actor_unavailable' }
  | { kind: 'reused'; actorType: ActorType; actorId: string };

/**
 * ATLAS-P0-AUTH-001: la rotación entera (leer, validar, revocar el viejo, crear el nuevo) corre
 * dentro de una única transacción con el token bloqueado por `FOR UPDATE`
 * (`AuthRefreshTokensRepository.findRefreshTokenForUpdate`). Dos refresh concurrentes con el mismo
 * token ya no pueden leer ambos "todavía activo" y rotar dos veces: el segundo espera a que el
 * primero haga commit, y al releer ve el token ya revocado — cae en la rama de reuso.
 *
 * La transacción SIEMPRE resuelve (nunca lanza) y retorna un resultado discriminado; las
 * excepciones las lanza quien llama, después del commit. Esto es deliberado: si lanzáramos
 * dentro del callback de `sequelize.transaction`, Sequelize haría rollback automático — y en el
 * caso de reuso detectado, la revocación de la cadena de descendientes es justo lo que NO
 * queremos perder aunque la solicitud en sí termine en 401.
 */
@Injectable()
export class AuthRefreshRotationService {
  constructor(
    private readonly authCredentials: AuthCredentialRepository,
    private readonly refreshTokens: AuthRefreshTokensRepository,
    private readonly actorResolver: AuthActorResolverService,
    private readonly tokenIssuer: AuthTokenIssuerService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  rotate(refreshToken: string, input: RefreshInput): Promise<RefreshOutcome> {
    const tokenHash = hashRefreshToken(refreshToken);
    return this.sequelize.transaction((transaction) => this.rotateWithinTransaction(tokenHash, input, transaction));
  }

  private async rotateWithinTransaction(tokenHash: string, input: RefreshInput, transaction: Transaction): Promise<RefreshOutcome> {
    const stored = await this.refreshTokens.findRefreshTokenForUpdate(tokenHash, transaction);
    if (!stored) return { kind: 'invalid' };

    const actorType = stored.actorType as ActorType;
    // Un token de otro tipo de actor llegado a la ruta equivocada se rechaza SIN rotarlo ni revocarlo.
    if (input.expectedActorType && actorType !== input.expectedActorType) return { kind: 'invalid' };

    if (stored.revokedAt) {
      // El token ya fue consumido antes. Si fue consumido específicamente por una rotación
      // (no por logout), que se vuelva a presentar es indicio de robo/reuso: alguien más tiene
      // una copia de un token que ya avanzó. Se corta toda la cadena de descendientes todavía
      // activos — no solo este token — porque el atacante pudo haber seguido rotando.
      if (stored.revokedReason === 'rotated') {
        const revokedDescendantIds = await this.refreshTokens.revokeDescendantChain(stored.id, transaction);
        await this.refreshTokens.recordRefreshReuseEvent(
          { tenantId: stored.tenantId, actorType, actorId: stored.actorId, reusedTokenId: stored.id, revokedDescendantIds },
          transaction,
        );
        return { kind: 'reused', actorType, actorId: stored.actorId };
      }
      return { kind: 'invalid' };
    }

    // Tope absoluto del cliente, contado desde el inicio de sesión con credenciales y no desde la última rotación.
    // Va antes del vencimiento porque su refresh token ya vence en ese mismo instante: así se responde con su código.
    const sessionStartedAt = sessionStartOf(stored);
    if (hasAbsoluteSessionCap(actorType) && isCustomerSessionExpired(sessionStartedAt)) {
      await this.refreshTokens.revokeRefreshToken(stored, SESSION_EXPIRED_REVOKE_REASON, undefined, { transaction });
      return { kind: 'session_expired' };
    }

    if (stored.expiresAt.getTime() < Date.now()) return { kind: 'invalid' };

    const credential = await this.authCredentials.findCredentialsByActor(actorType, stored.actorId, { transaction });
    if (!credential) return { kind: 'invalid' };

    // El rol/tenant vigentes se re-resuelven antes de emitir un refresh token nuevo.
    const refreshedActor = await this.actorResolver.reResolveActorRole(actorType, stored.actorId, stored.tenantId);
    if (!refreshedActor) return { kind: 'actor_unavailable' };

    // Rotación: el refresh token usado queda revocado y se emite uno nuevo, en la misma
    // transacción y con la fila todavía bloqueada. `replacedByTokenId` queda registrado para
    // poder reconstruir la cadena de rotación completa en una investigación de robo de tokens.
    const newRefreshToken = await this.tokenIssuer.issueRefreshToken(
      {
        tenantId: refreshedActor.tenantId,
        actorType,
        actorId: refreshedActor.id,
        userAgent: input.userAgent,
        ipAddress: input.ip,
        sessionStartedAt,
      },
      { transaction },
    );
    await this.refreshTokens.revokeRefreshToken(stored, 'rotated', newRefreshToken.id, { transaction });

    const accessToken = this.tokenIssuer.issueAccessToken(refreshedActor, actorType, credential.tokenVersion, sessionStartedAt);
    const expiresIn = this.tokenIssuer.accessTokenExpiresIn(actorType, sessionStartedAt);
    return { kind: 'success', accessToken, refreshToken: newRefreshToken.token, expiresIn };
  }
}
