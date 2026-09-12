/**
 * @file AT-045 — las raíces de API y worker están separadas y el worker CONSERVA el trabajo de fondo.
 * @business La API no arranca jobs y el worker no monta rutas; pero el worker tiene que seguir
 *   ejecutando lo que sólo corre en él: el monitor de salud de herramientas críticas y el tope del
 *   archivo de log. La primera versión de esta prueba comparaba una lista escrita a mano de 9 módulos
 *   y no vio que esos dos se habían quedado fuera (revisión independiente B, hallazgos 1-3).
 * @system Compara la diferencia REAL entre los `imports` de `AppModule` y `WorkerModule` con la lista
 *   congelada `WORKER_EXCLUDED_MODULES`, y arranca `WorkerModule` de verdad (Nest resuelve todos sus
 *   proveedores) contra PostgreSQL, como ya hace la prueba del worker del piloto.
 */
import { afterAll, describe, expect, it } from '@jest/globals';
import type { TestingModule } from '@nestjs/testing';
import 'reflect-metadata';
import { ApiModule } from '../../../src/bootstrap/api.module.js';
import { WORKER_EXCLUDED_MODULES, WorkerModule } from '../../../src/bootstrap/worker.module.js';
import { AppModule } from '../../../src/app.module.js';
import { integrationSkipRequested } from '../support/database.js';
import { requireIsolatedDatabase } from '../../support/isolated-database.guard.js';

let booted: TestingModule | null = null;

afterAll(async () => {
  await booted?.close();
});

function moduleNames(module: unknown): string[] {
  const list = (Reflect.getMetadata('imports', module as object) ?? []) as unknown[];
  return list.map((entry) =>
    typeof entry === 'function' ? entry.name : ((entry as { module?: { name: string } }).module?.name ?? 'dynamic'),
  );
}

/** Nombres de módulo alcanzables desde una raíz, siguiendo los `imports` hasta el fondo. */
function moduleClosure(root: unknown): Set<string> {
  const seen = new Set<string>();
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    const imports = (Reflect.getMetadata('imports', current as object) ?? []) as unknown[];
    for (const entry of imports) {
      const module = typeof entry === 'function' ? entry : (entry as { module?: unknown }).module;
      if (typeof module !== 'function') continue;
      const name = (module as { name: string }).name;
      if (seen.has(name)) continue;
      seen.add(name);
      pending.push(module);
    }
  }
  return seen;
}

describe('raíces API y worker (AT-045)', () => {
  it('el worker no declara controladores', () => {
    expect(Reflect.getMetadata('controllers', WorkerModule) ?? []).toEqual([]);
  });

  it('la diferencia entre las dos raíces es EXACTAMENTE la lista congelada (ni un módulo más ni uno menos)', () => {
    const api = moduleClosure(AppModule);
    const worker = moduleClosure(WorkerModule);
    const onlyInApi = [...api].filter((name) => !worker.has(name) && name.endsWith('Module')).sort();
    expect(onlyInApi).toEqual([...WORKER_EXCLUDED_MODULES].sort());
  });

  it('el worker conserva el trabajo de fondo que sólo corre en él', () => {
    const worker = moduleClosure(WorkerModule);
    // `SystemsOpsModule` = monitor de salud (se autodesactiva en la API); `LogSyncModule` = tope del
    // Archivo.log, que es per-proceso; `RuntimeJobsModule` = planificador; `EventsModule` = outbox.
    for (const required of [
      'SystemsOpsModule',
      'LogSyncModule',
      'RuntimeJobsModule',
      'EventsModule',
      'NotificationsModule',
      'DatabaseModule',
      'PlatformModule',
    ]) {
      expect([...worker]).toContain(required);
    }
  });

  it('la API compone la fachada completa y sigue montando los módulos de sólo-HTTP', () => {
    expect(moduleNames(ApiModule)).toEqual(['AppModule']);
    const appNames = moduleClosure(AppModule);
    for (const excluded of WORKER_EXCLUDED_MODULES) expect([...appNames]).toContain(excluded);
  });

  it('`WorkerModule` ARRANCA de verdad: Nest resuelve todos sus proveedores contra PostgreSQL', async () => {
    if (integrationSkipRequested()) return;
    requireIsolatedDatabase();
    const { Test } = await import('@nestjs/testing');
    booted = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await booted.init();
    const { SystemsHealthMonitorService } = await import('../../../src/modules/systems-ops/systems-health-monitor.service.js');
    expect(booted.get(SystemsHealthMonitorService, { strict: false })).toBeDefined();
  }, 60_000);

  it('con APP_ROLE=api no hay trabajo de fondo (regla del planificador y de la siembra)', async () => {
    const { runsBackgroundWork } = await import('../../../src/config/app-role.js');
    const { env } = await import('../../../src/config/env.js');
    expect(runsBackgroundWork()).toBe(env.APP_ROLE !== 'api');
  });
});
