/**
 * @file Almacén de la última instantánea del servidor, por tenant.
 * @business El informador la manda cada 5 min; si deja de mandarla, el portal tiene que enterarse, así que
 *   caduca sola a los 15 min en vez de enseñar un dato viejo como si fuera de ahora.
 * @system Redis con TTL (`SET … EX`). Sin Redis (desarrollo sin `REDIS_URL`) se degrada a memoria del
 *   proceso, con la misma caducidad: no hay tabla ni migración para algo que sólo vale 15 minutos.
 */
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module.js';
import type { HostSnapshotDto } from './systems-monitor-host.schemas.js';

export const HOST_SNAPSHOT_TTL_SECONDS = 15 * 60;
const key = (tenantId: string) => `systems-monitor:host:${tenantId}`;

@Injectable()
export class SystemsMonitorHostStore {
  private readonly memory = new Map<string, { expiresAt: number; value: HostSnapshotDto }>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  async save(tenantId: string, snapshot: HostSnapshotDto): Promise<void> {
    if (this.redis) {
      await this.redis.set(key(tenantId), JSON.stringify(snapshot), 'EX', HOST_SNAPSHOT_TTL_SECONDS);
      return;
    }
    this.memory.set(tenantId, { expiresAt: Date.now() + HOST_SNAPSHOT_TTL_SECONDS * 1000, value: snapshot });
  }

  async read(tenantId: string): Promise<HostSnapshotDto | null> {
    if (this.redis) {
      const raw = await this.redis.get(key(tenantId));
      return raw ? (JSON.parse(raw) as HostSnapshotDto) : null;
    }
    const hit = this.memory.get(tenantId);
    if (!hit || hit.expiresAt < Date.now()) return null;
    return hit.value;
  }
}
