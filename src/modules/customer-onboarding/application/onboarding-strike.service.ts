/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Equivocarse una vez con un correo o un carnet que ya existen no es una falta; insistir con varios distintos sí: ahí se corta el alta.
 * @system cuenta, por IP, dispositivo y cuenta, cuántos correos o carnets DISTINTOS ya registrados intentó alguien en 24 h (conjuntos en Redis; memoria sin Redis).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.module.js';
import { OnboardingIpBlockService } from './onboarding-ip-block.service.js';

/** Intentos distintos con un dato ya registrado a partir de los cuales se bloquea. */
export const ONBOARDING_STRIKE_LIMIT = 3;
export const ONBOARDING_STRIKE_WINDOW_SECONDS = 24 * 60 * 60;

@Injectable()
export class OnboardingStrikeService {
  private readonly logger = new Logger(OnboardingStrikeService.name);
  private readonly memory = new Map<string, { values: Set<string>; until: number }>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
    private readonly ipBlock: OnboardingIpBlockService,
  ) {}

  /**
   * Anota un intento con un dato ya registrado y devuelve el MAYOR número de datos distintos que alguno de
   * esos sujetos lleva intentados. Cuenta datos distintos y no peticiones: reintentar el mismo correo
   * (doble toque, reintento de red, la consulta del carnet y luego el envío) es una sola falta.
   */
  async record(subjects: Array<string | null | undefined>, valueId: string): Promise<number> {
    let max = 0;
    for (const subject of subjects) {
      if (!subject) continue;
      max = Math.max(max, await this.add(`atlas:onboarding:strikes:${subject}`, valueId));
    }
    return max;
  }

  /**
   * Un correo o teléfono que ya tiene cuenta, intentado en el arranque del alta. Aún no hay cuenta que
   * bloquear: al llegar al límite se bloquean la IP y el dispositivo. Devuelve si quedaron bloqueados.
   */
  async registerExistingContact(input: { ipAddress: string | null; fingerprint: string; valueHash: string }): Promise<boolean> {
    const strikes = await this.record([`ip:${input.ipAddress}`, `device:${input.fingerprint}`], input.valueHash);
    if (strikes < ONBOARDING_STRIKE_LIMIT) return false;
    await this.ipBlock.block(input.ipAddress, 'REPEATED_EXISTING_DATA');
    await this.ipBlock.blockDevice(input.fingerprint, 'REPEATED_EXISTING_DATA');
    this.logger.warn(
      `Reincidencia con correos o teléfonos ya registrados: IP ${input.ipAddress ?? 'desconocida'} y su dispositivo quedan bloqueados.`,
    );
    return true;
  }

  private async add(key: string, valueId: string): Promise<number> {
    const now = Date.now();
    const entry = this.memory.get(key);
    const vigente =
      entry && entry.until > now ? entry : { values: new Set<string>(), until: now + ONBOARDING_STRIKE_WINDOW_SECONDS * 1000 };
    vigente.values.add(valueId);
    this.memory.set(key, vigente);
    if (!this.redis) return vigente.values.size;
    try {
      const results = await this.redis.multi().sadd(key, valueId).expire(key, ONBOARDING_STRIKE_WINDOW_SECONDS).scard(key).exec();
      const count = Number(results?.[2]?.[1]);
      return Number.isFinite(count) ? Math.max(count, vigente.values.size) : vigente.values.size;
    } catch (error) {
      this.logger.warn(
        `No se pudo anotar el intento ${key} en Redis (cuenta en memoria): ${error instanceof Error ? error.message : error}`,
      );
      return vigente.values.size;
    }
  }
}
