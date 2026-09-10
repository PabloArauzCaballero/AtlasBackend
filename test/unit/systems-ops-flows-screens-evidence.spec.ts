import { SystemFlowsScreensService } from '../../src/modules/systems-ops/system-flows.screens.service.js';
import { ACCESS_EVIDENCE, CLIENT_EVIDENCE, indexBlockScreens } from '../../src/modules/systems-ops/system-flows.evidence.js';
import type { ScreenRuns } from '../../src/modules/systems-ops/system-flows.verification.util.js';

/**
 * Las pantallas del portal del ERP no dejan rastro en los logs de este backend: el portal sólo llama
 * al ERP. Ahora el ERP cuenta por pantalla y lo publica, y aquí se cruza. Lo que se protege son las
 * dos formas de que eso mienta sin fallar: que la verificación de un bloque despinte lo que verificó
 * otro, y que un contador que se vacía en cada despliegue se use para decir «nadie la usa».
 */
const runs = (over: Partial<ScreenRuns> = {}): ScreenRuns => ({
  calls: 1,
  failed: 0,
  lastAt: new Date('2026-09-10T10:00:00Z'),
  routes: [{ method: 'GET', path: '/api/v1/customers/:id', calls: 1, failed: 0 }],
  ...over,
});

function repositorio(observado = new Map<string, Map<string, ScreenRuns>>()) {
  const catalogo: Record<string, string[]> = {
    ADMIN_PORTAL: ['/internal/flows'],
    CONSUMER_APP: ['/'],
    ERP_PORTAL: ['/operaciones/clientes/:id'],
    MOTOR_PORTAL: ['/actions'],
  };
  return {
    screenRuns: jest.fn(async () => ({ porCliente: observado, truncado: false })),
    screenClients: async () => Object.keys(catalogo).sort(),
    screensOfClient: async (code: string) => (catalogo[code] ?? []).map((route) => ({ route })),
    applyScreenVerification: jest.fn(async () => undefined),
    resetScreensNotSeen: jest.fn(async () => 0),
  };
}
const dto = (systemCode: string) => ({ systemCode, windowDays: 30 }) as never;
const tx = {} as never;

describe('SystemFlowsScreensService.verify · quién verifica y quién degrada cada cliente', () => {
  it('la verificación del Backend no degrada pantallas de clientes que no le declaran su origen', async () => {
    const repo = repositorio(new Map([['ADMIN_PORTAL', new Map([['/internal/flows', runs()]])]]));
    const resultado = await new SystemFlowsScreensService(repo as never).verify(dto('ATLAS_BACKEND'), tx);
    expect(repo.resetScreensNotSeen.mock.calls.map((llamada: unknown[]) => llamada[0]).sort()).toEqual(['ADMIN_PORTAL', 'CONSUMER_APP']);
    expect(resultado).toMatchObject({ evidence: 'window', notMeasuredHere: ['ERP_PORTAL', 'MOTOR_PORTAL'] });
  });

  it('el ERP verifica las pantallas de su portal con lo que cuenta su proceso, y nunca degrada', async () => {
    const repo = repositorio();
    const federadas = {
      porCliente: new Map([['ERP_PORTAL', new Map([['/operaciones/clientes/42', runs({ calls: 2 })]])]]),
      truncado: false,
    };
    const resultado = await new SystemFlowsScreensService(repo as never).verify(
      dto('ERP_BACKEND'),
      tx,
      federadas,
      'http_access_registry.screens',
    );
    expect(repo.applyScreenVerification).toHaveBeenCalledWith(
      'ERP_PORTAL',
      '/operaciones/clientes/:id',
      expect.objectContaining({
        verification: 'VERIFIED',
        observed: expect.objectContaining({ source: 'http_access_registry.screens', calls: 2 }),
      }),
      tx,
    );
    expect(repo.resetScreensNotSeen).not.toHaveBeenCalled();
    expect(repo.screenRuns).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ evidence: 'process', byClient: { ERP_PORTAL: { total: 1, verified: 1 } } });
  });

  it('lo que el ERP diga de otro cliente no se aplica: sólo mide a su portal', async () => {
    const repo = repositorio();
    const federadas = { porCliente: new Map([['ADMIN_PORTAL', new Map([['/internal/flows', runs()]])]]), truncado: false };
    await new SystemFlowsScreensService(repo as never).verify(dto('ERP_BACKEND'), tx, federadas);
    expect(repo.applyScreenVerification).not.toHaveBeenCalled();
  });

  it('un bloque sin evidencia de pantallas no toca el catálogo', async () => {
    const repo = repositorio();
    expect(await new SystemFlowsScreensService(repo as never).verify(dto('DECISION_ENGINE'), tx, null)).toBeUndefined();
    expect(repo.applyScreenVerification).not.toHaveBeenCalled();
    expect(repo.resetScreensNotSeen).not.toHaveBeenCalled();
  });
});

describe('indexBlockScreens · lo que publica el ERP', () => {
  it('lee cliente, pantalla y rutas, y descarta lo que no tiene forma de pantalla', () => {
    const { porCliente, truncado } = indexBlockScreens({
      screens: [
        {
          client: 'ERP_PORTAL',
          screen: '/a',
          calls: 3,
          failed: 1,
          lastAt: '2026-09-10T10:00:00.000Z',
          routes: [{ method: 'GET', path: '/x', calls: 3, failed: 1 }],
        },
        { client: 5, screen: '/b' },
        null,
      ],
      screensTruncated: true,
    });
    expect(porCliente.size).toBe(1);
    expect(porCliente.get('ERP_PORTAL')?.get('/a')).toMatchObject({ calls: 3, failed: 1 });
    expect(porCliente.get('ERP_PORTAL')?.get('/a')?.lastAt?.toISOString()).toBe('2026-09-10T10:00:00.000Z');
    expect(truncado).toBe(true);
  });

  it('un ERP que aún no publica pantallas da un mapa vacío, no un error', () => {
    expect(indexBlockScreens({ entries: [] })).toEqual({ porCliente: new Map(), truncado: false });
    expect(indexBlockScreens(undefined)).toEqual({ porCliente: new Map(), truncado: false });
  });

  it('el ERP declara pantallas y mide a su portal; el Motor todavía no', () => {
    expect(ACCESS_EVIDENCE.ERP_BACKEND.screens).toBeDefined();
    expect(ACCESS_EVIDENCE.DECISION_ENGINE.screens).toBeUndefined();
    expect(CLIENT_EVIDENCE.ERP_PORTAL).toBe('ERP_BACKEND');
    expect(CLIENT_EVIDENCE.MOTOR_PORTAL).toBeUndefined();
  });
});
