/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Quien intenta registrar el carnet de OTRA persona queda fuera del alta desde esa conexión Y desde ese teléfono: cambiar de IP no basta.
 * @system guarda en Redis (con caducidad) las IP y las huellas de dispositivo bloqueadas del alta; sin Redis degrada a memoria del proceso.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.module.js';

/** Cuánto dura el bloqueo de una IP. Un bloqueo eterno castiga a quien comparte salida a internet con el infractor. */
export const ONBOARDING_IP_BLOCK_TTL_SECONDS = 24 * 60 * 60;
/** Un teléfono no se comparte: el bloqueo del dispositivo dura más que el de la IP. */
export const ONBOARDING_DEVICE_BLOCK_TTL_SECONDS = 7 * 24 * 60 * 60;

export type OnboardingBlockReason = 'IDENTITY_DOCUMENT_ALREADY_REGISTERED';

@Injectable()
export class OnboardingIpBlockService {
  private readonly logger = new Logger(OnboardingIpBlockService.name);
  /** Respaldo si Redis no está o falla: vale para este proceso, que es mejor que no bloquear nada. */
  private readonly memory = new Map<string, number>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  block(ip: string | null | undefined, reason: OnboardingBlockReason): Promise<void> {
    return this.set(`atlas:onboarding:ip-block:${ip}`, ip, reason, ONBOARDING_IP_BLOCK_TTL_SECONDS);
  }

  isBlocked(ip: string | null | undefined): Promise<boolean> {
    return this.has(`atlas:onboarding:ip-block:${ip}`, ip);
  }

  /** La huella que el teléfono declara en el alta (`device.deviceFingerprintHash`). */
  blockDevice(fingerprint: string | null | undefined, reason: OnboardingBlockReason): Promise<void> {
    return this.set(`atlas:onboarding:device-block:${fingerprint}`, fingerprint, reason, ONBOARDING_DEVICE_BLOCK_TTL_SECONDS);
  }

  isDeviceBlocked(fingerprint: string | null | undefined): Promise<boolean> {
    return this.has(`atlas:onboarding:device-block:${fingerprint}`, fingerprint);
  }

  private async set(key: string, subject: string | null | undefined, reason: OnboardingBlockReason, ttlSeconds: number): Promise<void> {
    if (!subject) return;
    this.memory.set(key, Date.now() + ttlSeconds * 1000);
    if (!this.redis) return;
    try {
      await this.redis.set(key, reason, 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(
        `No se pudo guardar el bloqueo ${key} en Redis (queda en memoria): ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private async has(key: string, subject: string | null | undefined): Promise<boolean> {
    if (!subject) return false;
    const until = this.memory.get(key);
    if (until !== undefined) {
      if (until > Date.now()) return true;
      this.memory.delete(key);
    }
    if (!this.redis) return false;
    try {
      return (await this.redis.exists(key)) === 1;
    } catch (error) {
      this.logger.warn(`No se pudo leer el bloqueo ${key} en Redis (se deja pasar): ${error instanceof Error ? error.message : error}`);
      return false;
    }
  }
}
