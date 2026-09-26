/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de services sin introducir reglas de un dominio específico.
 */
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
    const version = await this.bumpTokenVersionIfPresent(actorType, actorId);
    if (version === null) {
      throw new Error(`No existen credenciales para ${actorType}:${actorId}.`);
    }

    return version;
  }

  /**
   * Igual que `bumpTokenVersion`, pero devuelve `null` en vez de lanzar cuando el actor no tiene
   * credenciales.
   *
   * Un actor sin fila en `auth_credentials` no puede iniciar sesión, así que no existe ningún access
   * token vigente que revocar: no hay nada que hacer y tampoco nada que reportar. Los llamantes que
   * revocan como **efecto secundario** de un cambio de privilegios (suspender un usuario, reemplazar
   * sus roles) deben usar esta variante — con la que lanza, un usuario interno creado por seed y aún
   * sin contraseña provisionada convertiría un cambio legítimo en un 500 **con el cambio ya escrito**,
   * dejando al operador convencido de que la operación falló cuando en realidad se aplicó.
   */
  async bumpTokenVersionIfPresent(actorType: string, actorId: string): Promise<number | null> {
    const record = await this.credentialModel.findOne({ where: { actorType, actorId, deleted: false } as never });
    if (!record) {
      return null;
    }
    record.tokenVersion += 1;
    await record.save();

    if (this.redis) {
      await this.writeThroughOrInvalidate(actorType, actorId, record.tokenVersion);
    }

    return record.tokenVersion;
  }

  /**
   * Publica la versión nueva en la caché y, si no puede, BORRA la entrada.
   *
   * El borrado no es una cortesía: es lo que hace que la revocación siga siendo cierta.
   *
   * Antes, un `SET` fallido sólo se registraba, con el argumento de que «la próxima lectura sin hit
   * de caché va a la base de datos, que ya tiene el valor nuevo». Eso vale si la clave quedara
   * AUSENTE, y un `SET` que falla deja intacta la ANTERIOR: la versión vieja sobrevive hasta su TTL
   * (5 min), `getCurrentTokenVersion` la sirve sin consultar la base —lee Redis primero— y
   * `JwtAuthGuard` compara la versión del token contra ella, ve que coinciden y **acepta un token
   * ya revocado**. El caso se da justo cuando más duele: cambiar la contraseña y «cerrar sesión en
   * todos los dispositivos» son lo que se hace después de un robo de credenciales.
   *
   * Un fallo del borrado sí es `error` y no `warn`: en ese punto queda una credencial revocada que
   * la caché sigue dando por buena y nadie más va a enterarse.
   */
  private async writeThroughOrInvalidate(actorType: string, actorId: string, tokenVersion: number): Promise<void> {
    const key = this.cacheKey(actorType, actorId);
    try {
      // Write-through: la revocación queda efectiva de inmediato, sin esperar el TTL.
      await this.redis?.set(key, String(tokenVersion), 'EX', TokenRevocationService.CACHE_TTL_SECONDS);
      return;
    } catch (error) {
      this.logger.warn(
        `Fallo escribiendo tokenVersion en caché tras bump; se invalida la entrada: ${error instanceof Error ? error.message : error}`,
      );
    }

    try {
      // Fail-closed: sin entrada, la siguiente lectura baja a la base de datos, que ya tiene la
      // versión nueva. Se pierde el acierto de caché; no se pierde la revocación.
      await this.redis?.del(key);
    } catch (error) {
      this.logger.error(
        `No se pudo invalidar la caché de tokenVersion de ${actorType}:${actorId}: la revocación puede tardar hasta ` +
          `${String(TokenRevocationService.CACHE_TTL_SECONDS)} s en hacerse efectiva. ` +
          `Causa: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
