/**
 * @file AT-045 — la raíz del worker no monta rutas ni módulos de sólo-HTTP; la API sin rol de fondo no planifica.
 * @business Un worker no expone endpoints de negocio; una API con APP_ROLE=api no ejecuta jobs duplicados.
 * @system Lee la composición declarada de `WorkerModule` (metadatos Nest) y la regla `runsBackgroundWork`.
 */
import { describe, expect, it } from '@jest/globals';
import 'reflect-metadata';
import { WORKER_EXCLUDED_MODULES, WorkerModule } from '../../../src/bootstrap/worker.module.js';
import { ApiModule } from '../../../src/bootstrap/api.module.js';
import { AppModule } from '../../../src/app.module.js';

function imports(module: unknown): string[] {
  const list = (Reflect.getMetadata('imports', module as object) ?? []) as unknown[];
  return list.map((entry) =>
    typeof entry === 'function' ? entry.name : ((entry as { module?: { name: string } }).module?.name ?? 'dynamic'),
  );
}

describe('raíces API y worker (AT-045)', () => {
  it('el worker no declara controladores y no importa los módulos de sólo-HTTP', () => {
    expect(Reflect.getMetadata('controllers', WorkerModule) ?? []).toEqual([]);
    const names = imports(WorkerModule);
    for (const excluded of WORKER_EXCLUDED_MODULES) expect(names).not.toContain(excluded);
    expect(names).toEqual(
      expect.arrayContaining(['RuntimeJobsModule', 'EventsModule', 'NotificationsModule', 'DatabaseModule', 'PlatformModule']),
    );
  });

  it('la API compone la fachada completa (compatibilidad) y la App sigue montando los módulos de sólo-HTTP', () => {
    expect(imports(ApiModule)).toEqual(['AppModule']);
    const appNames = imports(AppModule);
    for (const excluded of WORKER_EXCLUDED_MODULES) expect(appNames).toContain(excluded);
  });

  it('con APP_ROLE=api no hay trabajo de fondo (regla del planificador y de la siembra)', async () => {
    const { runsBackgroundWork } = await import('../../../src/config/app-role.js');
    const { env } = await import('../../../src/config/env.js');
    expect(runsBackgroundWork()).toBe(env.APP_ROLE !== 'api');
  });
});
