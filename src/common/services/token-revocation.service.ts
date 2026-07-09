import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import type Redis from 'ioredis';
import { AuthCredentialModel } from '../../database/models/index.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';

/**
 * Cierra ATLAS-AUDIT-026: hasta el patch anterior, `AuthenticatedUser.tokenVersion` se extraía
 * del JWT pero nunca se comparaba contra nada — el campo existía sin ninguna lógica de
 * revocación detrás, lo que podía dar una falsa sensación de que "la revocación de tokens ya
 * funciona".
 *
 * Este servicio es la única fuente de verdad sobre la versión vigente de token de un actor.
 * `JwtAuthGuard` la consulta en cada request autenticado; `AuthService` la incrementa al
 * cambiar contraseña o forzar cierre de sesión ("logout de todos los dispositivos").
 *
 * Es un servicio `@Global()` (ver `common-auth.module.ts`) para que cualquier guard pueda
 * inyectarlo sin que cada módulo de negocio tenga que importar el módulo de auth completo.
 *
 * ATLAS-P10-013 (cierra el punto de rendimiento documentado en assumptions.md): esta consulta
 * corre en cada request autenticado, así que se agrega una capa de caché en Redis delante de la
 * base de datos:
 *  - Lectura: intenta Redis primero; si hay hit, no toca la base de datos. Si Redis no está
 *    configurado (`REDIS_URL` vacío, válido en desarrollo con una sola instancia) o falla, se
 *    degrada de forma explícita a la base de datos — nunca se rompe la revocación por un
 *    problema de caché.
 *  - Escritura (`bumpTokenVersion`): además de persistir en la base de datos, escribe
 *    inmediatamente ("write-through") el nuevo valor en Redis, para que la revocación sea
 *    efectiva en el siguiente request sin esperar a que expire un TTL.
 *  - TTL de seguridad (`CACHE_TTL_SECONDS`): red de seguridad ante cualquier escritura de caché
 *    que falle silenciosamente (p. ej. Redis no disponible en el instante del bump); acota el
 *    tiempo máximo en que un token ya revocado podría seguir aceptándose por un dato de caché
 *    desactualizado.
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
