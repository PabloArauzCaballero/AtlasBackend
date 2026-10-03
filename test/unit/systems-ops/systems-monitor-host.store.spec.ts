import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { HOST_SNAPSHOT_TTL_SECONDS, SystemsMonitorHostStore } from '../../../src/modules/systems-ops/systems-monitor-host.store.js';
import { hostSnapshotSchema, type HostSnapshotDto } from '../../../src/modules/systems-ops/systems-monitor-host.schemas.js';

const snapshot: HostSnapshotDto = {
  capturedAt: '2026-10-03T14:00:00.000Z',
  ramAvailableMb: 8000,
  ramTotalMb: 24031,
  swapFreeMb: 70,
  swapTotalMb: 4095,
  load1: 12.5,
  load15: 14.2,
  cores: 8,
  diskPct: 59,
  buildCacheGb: 110,
  backupAgeHours: 3,
  apps: [{ name: 'erp-backend', principal: 'healthy', respaldo: 'healthy', memoryPct: 41.2 }],
};

describe('SystemsMonitorHostStore', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('con Redis guarda con caducidad de 15 min y lee lo guardado', async () => {
    const stored = new Map<string, string>();
    const redis = {
      set: jest.fn(async (k: string, v: string, _mode?: string, _ttl?: number) => (stored.set(k, v), 'OK')),
      get: jest.fn(async (k: string) => stored.get(k) ?? null),
    };
    const store = new SystemsMonitorHostStore(redis as never);

    await store.save('1', snapshot);

    expect(redis.set).toHaveBeenCalledWith('systems-monitor:host:1', JSON.stringify(snapshot), 'EX', HOST_SNAPSHOT_TTL_SECONDS);
    expect(HOST_SNAPSHOT_TTL_SECONDS).toBe(900);
    await expect(store.read('1')).resolves.toEqual(snapshot);
  });

  it('cada tenant ve lo suyo y nada más', async () => {
    const store = new SystemsMonitorHostStore(null);
    await store.save('1', snapshot);
    await expect(store.read('2')).resolves.toBeNull();
  });

  it('sin Redis cae a memoria con la misma caducidad', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-03T14:00:00Z'));
    const store = new SystemsMonitorHostStore(null);
    await store.save('1', snapshot);

    jest.setSystemTime(new Date('2026-10-03T14:14:59Z'));
    await expect(store.read('1')).resolves.toEqual(snapshot);
    jest.setSystemTime(new Date('2026-10-03T14:15:01Z'));
    await expect(store.read('1')).resolves.toBeNull();
  });
});

describe('hostSnapshotSchema', () => {
  it('acepta una instantánea completa', () => {
    expect(hostSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('rechaza campos de más: la ruta no admite cuerpos arbitrarios', () => {
    expect(hostSnapshotSchema.safeParse({ ...snapshot, comando: 'rm -rf /' }).success).toBe(false);
  });

  it('rechaza valores imposibles', () => {
    expect(hostSnapshotSchema.safeParse({ ...snapshot, diskPct: 101 }).success).toBe(false);
    expect(hostSnapshotSchema.safeParse({ ...snapshot, ramTotalMb: 0 }).success).toBe(false);
    expect(hostSnapshotSchema.safeParse({ ...snapshot, capturedAt: 'ayer' }).success).toBe(false);
    expect(hostSnapshotSchema.safeParse({ ...snapshot, apps: Array.from({ length: 41 }, () => snapshot.apps[0]) }).success).toBe(false);
  });
});
