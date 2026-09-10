import { matchScreenRuns, screenVerificationFrom, type ScreenRuns } from '../../src/modules/systems-ops/system-flows.verification.util.js';

/**
 * Las 267 pantallas del catálogo no tenían eje de verificación: se sabía que existían en el código
 * y nada más. La arista pantalla→endpoint se derivaba del AST, así que decía lo que el código PARECE
 * hacer. Esto cruza lo que de verdad se hizo desde cada pantalla, que el portal declara en
 * `x-atlas-flow` y el backend guarda en `origin_screen`.
 *
 * El cliente manda la ruta CONCRETA porque no sabe qué segmento es dinámico sin adivinar; aquí están
 * las plantillas, así que aquí se resuelve. Lo que se protege es esa resolución, que es donde una
 * visita se atribuye a la pantalla equivocada sin que nada falle.
 */
const runs = (over: Partial<ScreenRuns> = {}): ScreenRuns => ({
  calls: 1,
  failed: 0,
  lastAt: new Date('2026-09-10T10:00:00Z'),
  routes: [{ method: 'GET', path: 'systems/flows', calls: 1, failed: 0 }],
  ...over,
});

describe('matchScreenRuns · de la ruta concreta a la plantilla', () => {
  it('una ruta sin parámetros se atribuye a sí misma', () => {
    const { porPlantilla, sinCatalogar } = matchScreenRuns(new Map([['/internal/flows', runs()]]), ['/internal/flows']);
    expect(porPlantilla.get('/internal/flows')?.calls).toBe(1);
    expect(sinCatalogar).toEqual([]);
  });

  it('una ruta con identificador se atribuye a su plantilla', () => {
    const { porPlantilla } = matchScreenRuns(new Map([['/internal/audit/request/abc123', runs()]]), ['/internal/audit/request/:requestId']);
    expect(porPlantilla.get('/internal/audit/request/:requestId')?.calls).toBe(1);
  });

  it('gana la literal exacta sobre la que lleva parámetro', () => {
    // Sin esta regla, la pantalla de ALTA de un cliente se contaría como visita a la ficha de un
    // cliente llamado «new», que no existe.
    const { porPlantilla } = matchScreenRuns(new Map([['/internal/customers/new', runs()]]), [
      '/internal/customers/:id',
      '/internal/customers/new',
    ]);
    expect(porPlantilla.has('/internal/customers/new')).toBe(true);
    expect(porPlantilla.has('/internal/customers/:id')).toBe(false);
  });

  it('a igualdad de encaje gana la de MENOS parámetros', () => {
    const { porPlantilla } = matchScreenRuns(new Map([['/a/b/c', runs()]]), ['/a/:x/:y', '/a/b/:y']);
    expect(porPlantilla.has('/a/b/:y')).toBe(true);
  });

  it('el identificador no se cuela en un segmento estático', () => {
    // La versión que reconstruía la plantilla en el cliente producía aquí `/:id/customers/:id`.
    const { porPlantilla, sinCatalogar } = matchScreenRuns(new Map([['/internal/customers/internal', runs()]]), [
      '/internal/customers/:id',
    ]);
    expect(porPlantilla.has('/internal/customers/:id')).toBe(true);
    expect(sinCatalogar).toEqual([]);
  });

  it('dos visitas con identificadores distintos son la MISMA pantalla y se suman', () => {
    const { porPlantilla } = matchScreenRuns(
      new Map([
        [
          '/internal/customers/1',
          runs({
            calls: 2,
            lastAt: new Date('2026-09-10T09:00:00Z'),
            routes: [{ method: 'GET', path: 'systems/flows', calls: 2, failed: 0 }],
          }),
        ],
        ['/internal/customers/2', runs({ calls: 3, failed: 1, routes: [{ method: 'GET', path: 'systems/flows', calls: 3, failed: 1 }] })],
      ]),
      ['/internal/customers/:id'],
    );
    const pantalla = porPlantilla.get('/internal/customers/:id');
    expect(pantalla).toMatchObject({ calls: 5, failed: 1 });
    // Se queda la fecha más reciente de las dos, no la última que se procesó.
    expect(pantalla?.lastAt?.toISOString()).toBe('2026-09-10T10:00:00.000Z');
    // Y las llamadas a la misma ruta se funden en vez de duplicar la fila.
    expect(pantalla?.routes).toEqual([{ method: 'GET', path: 'systems/flows', calls: 5, failed: 1 }]);
  });

  it('una ruta que ninguna plantilla reconoce se declara, no se descarta en silencio', () => {
    const { porPlantilla, sinCatalogar } = matchScreenRuns(new Map([['/internal/pantalla-que-ya-no-existe', runs()]]), ['/internal/flows']);
    expect(porPlantilla.size).toBe(0);
    expect(sinCatalogar).toEqual(['/internal/pantalla-que-ya-no-existe']);
  });

  it('los metacaracteres de la plantilla no se interpretan como expresión regular', () => {
    const { porPlantilla, sinCatalogar } = matchScreenRuns(new Map([['/internal/aXb/1', runs()]]), ['/internal/a.b/:id']);
    expect(porPlantilla.size).toBe(0);
    expect(sinCatalogar).toEqual(['/internal/aXb/1']);
  });
});

describe('screenVerificationFrom · qué se afirma de una pantalla', () => {
  it('con corridas queda VERIFIED y guarda contra qué llamó de verdad', () => {
    const outcome = screenVerificationFrom(runs({ calls: 4, failed: 1 }));
    expect(outcome).toMatchObject({ verification: 'VERIFIED' });
    expect(outcome?.observed).toMatchObject({ source: expect.stringContaining('origin_screen'), calls: 4, failed: 1 });
  });

  it('sin corridas NO se opina: una pantalla que nadie abrió no es una pantalla rota', () => {
    expect(screenVerificationFrom(null)).toBeNull();
    expect(screenVerificationFrom(runs({ calls: 0 }))).toBeNull();
  });

  it('llamadas fallidas NO marcan la pantalla: lo que falla es el endpoint, que tiene su propia ficha', () => {
    expect(screenVerificationFrom(runs({ calls: 3, failed: 3 }))?.verification).toBe('VERIFIED');
  });
});
