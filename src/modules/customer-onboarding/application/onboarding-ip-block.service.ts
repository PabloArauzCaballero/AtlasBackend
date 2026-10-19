/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Una conexión desde la que se intenta registrar el carnet de OTRA persona queda fuera del alta: es la señal más clara de suplantación de identidad.
 * @system guarda en Redis (con caducidad) las IP bloqueadas del alta y responde si una IP lo está; sin Redis degrada a memoria del proceso.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.module.js';

/** Cuánto dura el bloqueo. Un bloqueo eterno castiga a quien comparte salida a internet con el infractor. */
export const ONBOARDING_IP_BLOCK_TTL_SECONDS = 24 * 60 * 60;

export type OnboardingIpBlockReason = 'IDENTITY_DOCUMENT_ALREADY_REGISTERED';

@Injectable()
export class OnboardingIpBlockService {
  private readonly logger = new Logger(OnboardingIpBlockService.name);
  /** Respaldo si Redis no está o falla: vale para este proceso, que es mejor que no bloquear nada. */
  private readonly memory = new Map<string, number>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  private key(ip: string): string {
    return `atlas:onboarding:ip-block:${ip}`;
  }

  async block(ip: string | null | undefined, reason: OnboardingIpBlockReason): Promise<void> {
    if (!ip) return;
    this.memory.set(ip, Date.now() + ONBOARDING_IP_BLOCK_TTL_SECONDS * 1000);
    if (!this.redis) return;
    try {
      await this.redis.set(this.key(ip), reason, 'EX', ONBOARDING_IP_BLOCK_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(
        `No se pudo guardar el bloqueo de ${ip} en Redis (queda en memoria): ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async isBlocked(ip: string | null | undefined): Promise<boolean> {
    if (!ip) return false;
    const until = this.memory.get(ip);
    if (until !== undefined) {
      if (until > Date.now()) return true;
      this.memory.delete(ip);
    }
    if (!this.redis) return false;
    try {
      return (await this.redis.exists(this.key(ip))) === 1;
    } catch (error) {
      this.logger.warn(`No se pudo leer el bloqueo de ${ip} en Redis (se deja pasar): ${error instanceof Error ? error.message : error}`);
      return false;
    }
  }
}
