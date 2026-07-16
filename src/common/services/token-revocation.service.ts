import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import type Redis from 'ioredis';
import { AuthCredentialModel } from '../../database/models/index.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';

/**
 * Fuente de verdad para la versión vigente de token de un actor.
 *
 * `JwtAuthGuard` consulta este servicio en cada request autenticado; `AuthService` incrementa
 * la versión al cambiar contraseña o cerrar sesión en todos los dispositivos. Redis funciona
 * como caché write-through y nunca reemplaza a `auth_credentials.token_version`.
 */
@Injectable()
export class TokenRevocationService {
  private readonly logger = new Logger(TokenRevocationService.name);
  private static readonly CACHE_TTL_SECONDS = 300;

  constructor(
    @InjectModel(AuthCredentialModel) private readonly credentialModel: typeof AuthCredentialModel,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  private cacheKey(actorType: string, actorId: string): string {
    return `atlas:auth:token-version:${actorType}:${actorId}`;
  }

  async getCurrentTokenVersion(actorType: string, actorId: string): Promise<number | null> {
    const key = this.cacheKey(actorType, actorId);

    if (this.redis) {
      try {
        const cached = await this.redis.get(key);
        if (cached !== null) {
          const parsed = Number(cached);
          if (Number.isFinite(parsed)) return parsed;
        }
      } catch (error) {
        this.logger.warn(`Fallo leyendo caché de tokenVersion (se degrada a DB): ${error instanceof Error ? error.message : error}`);
      }
    }

    const record = await this.credentialModel.findOne({
      where: { actorType, actorId, deleted: false } as never,
      attributes: ['tokenVersion'],
    });
    const version = record ? record.tokenVersion : null;

    if (version !== null && this.redis) {
      try {
        await this.redis.set(key, String(version), 'EX', TokenRevocationService.CACHE_TTL_SECONDS);
      } catch (error) {
        this.logger.warn(`Fallo escribiendo caché de tokenVersion (no bloqueante): ${error instanceof Error ? error.message : error}`);
      }
    }

    return version;
  }

  async bumpTokenVersion(actorType: string, actorId: string): Promise<number> {
    const record = await this.credentialModel.findOne({ where: { actorType, actorId, deleted: false } as never });
    if (!record) {
      throw new Error(`No existen credenciales para ${actorType}:${actorId}.`);
    }
    record.tokenVersion += 1;
    await record.save();

    if (this.redis) {
      const key = this.cacheKey(actorType, actorId);
      try {
        // Write-through: la revocación queda efectiva de inmediato, sin esperar el TTL.
        await this.redis.set(key, String(record.tokenVersion), 'EX', TokenRevocationService.CACHE_TTL_SECONDS);
      } catch (error) {
        // No bloqueamos el bump por un fallo de caché, pero si esto falla la revocación sigue
        // siendo correcta igual: la próxima lectura sin hit de caché va a la base de datos, que
        // ya tiene el valor nuevo.
        this.logger.warn(
          `Fallo invalidando caché de tokenVersion tras bump (no bloqueante): ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    return record.tokenVersion;
  }
}
