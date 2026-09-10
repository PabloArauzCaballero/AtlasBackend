import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { ExpedientesRepository } from '../../../src/modules/expedientes/repositories/expedientes.repository.js';
import type { ExpedienteActividadModel, ExpedienteModel, ExpedienteNodoModel } from '../../../src/database/models/index.js';

/**
 * Las consultas del expediente.
 *
 * Un repositorio se prueba por lo que su consulta DEJA FUERA, no por lo que devuelve. Aquí lo que
 * se fija son tres cosas que no fallan nunca en pantalla y sí en producción: que ninguna consulta
 * por-tenant se quede sin `tenantId` —sería una fuga entre clientes—, que un `%` escrito por un
 * humano en el buscador viaje escapado —si no, la búsqueda devuelve el censo entero y, en
 * `findSubarbol`, el borrado recursivo se lleva por delante un subárbol ajeno—, y que las tres
 * consultas que a propósito NO llevan tenant sigan sin llevarlo.
 */
type Doble = {
  create: jest.Mock;
  findOne: jest.Mock;
  findAll: jest.Mock;
  findAndCountAll: jest.Mock;
  update: jest.Mock;
  destroy: jest.Mock;
  count: jest.Mock;
};

function doble(): Doble {
  return {
    create: jest.fn(async () => ({ id: 'x' })),
    findOne: jest.fn(async () => null),
    findAll: jest.fn(async () => []),
    findAndCountAll: jest.fn(async () => ({ rows: [], count: 0 })),
    update: jest.fn(async () => [0]),
    destroy: jest.fn(async () => 0),
    count: jest.fn(async () => 0),
  };
}

/** El `where` de la última llamada al método indicado. */
function where(mock: jest.Mock): Record<string | symbol, unknown> {
  const ultima = mock.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> };
  return ultima.where;
}

describe('ExpedientesRepository', () => {
  let expedientes: Doble;
  let nodos: Doble;
  let actividad: Doble;
  let repo: ExpedientesRepository;

  beforeEach(() => {
    expedientes = doble();
    nodos = doble();
    actividad = doble();
    repo = new ExpedientesRepository(
      expedientes as unknown as typeof ExpedienteModel,
      nodos as unknown as typeof ExpedienteNodoModel,
      actividad as unknown as typeof ExpedienteActividadModel,
    );
  });

  describe('expedientes', () => {
    it('nace abierto: el estado no lo elige quien llama', async () => {
      await repo.crearExpediente({
        tenantId: 't1',
        subjectType: 'customer',
        subjectId: 'c1',
        sessionId: null,
        customerCode: null,
        creadoPorTipo: 'internal_user',
        creadoPorId: '7',
      });

      expect(expedientes.create).toHaveBeenCalledWith(expect.objectContaining({ estado: 'abierto' }), { transaction: undefined });
    });

    it('buscar por id exige el tenant: sin él, un id de otro cliente devolvería su expediente', async () => {
      await repo.findExpediente('t1', 'exp-1');
      expect(where(expedientes.findOne)).toEqual({ tenantId: 't1', id: 'exp-1' });
    });

    it('con sesión devuelve la de esa sesión; sin ella, la más reciente', async () => {
      await repo.findExpedientePorSujeto('t1', 'customer', 'c1', 's9');
      expect(where(expedientes.findOne)).toEqual({ tenantId: 't1', subjectType: 'customer', subjectId: 'c1', sessionId: 's9' });

      await repo.findExpedientePorSujeto('t1', 'customer', 'c1');
      expect(where(expedientes.findOne)).toEqual({ tenantId: 't1', subjectType: 'customer', subjectId: 'c1' });
      expect((expedientes.findOne.mock.calls.at(-1)?.[0] as { order: unknown[] }).order).toEqual([['created_at', 'DESC']]);
    });

    it('el listado sin filtros sólo acota por tenant', async () => {
      await repo.listarExpedientes({ tenantId: 't1', offset: 0, limit: 20 });
      expect(where(expedientes.findAndCountAll)).toEqual({ tenantId: 't1' });
    });

    it('escapa los comodines del buscador: un `%` suelto devolvería el censo entero', async () => {
      await repo.listarExpedientes({ tenantId: 't1', q: '100%_x', offset: 0, limit: 20 });

      const condiciones = where(expedientes.findAndCountAll)[Op.or] as Array<{ customerCode: { [Op.iLike]: string } }>;
      expect(condiciones[0].customerCode[Op.iLike]).toBe('%100\\%\\_x%');
    });

    it('un texto todo dígitos busca además por identificador exacto del sujeto; uno con letras no', async () => {
      await repo.listarExpedientes({ tenantId: 't1', q: '4321', offset: 0, limit: 20 });
      expect(where(expedientes.findAndCountAll)[Op.or]).toHaveLength(2);

      await repo.listarExpedientes({ tenantId: 't1', q: 'CLI-4321', offset: 0, limit: 20 });
      expect(where(expedientes.findAndCountAll)[Op.or]).toHaveLength(1);
    });

    it('los filtros de tipo y estado se aplican sólo cuando llegan', async () => {
      await repo.listarExpedientes({ tenantId: 't1', subjectType: 'partner', estado: 'enviado', offset: 0, limit: 20 });
      expect(where(expedientes.findAndCountAll)).toEqual({ tenantId: 't1', subjectType: 'partner', estado: 'enviado' });
    });

    it('actualizar toca la fila de ese tenant y sella `updated_at`', async () => {
      await repo.actualizarExpediente('t1', 'exp-1', { estado: 'purgado' });

      const [values, opciones] = expedientes.update.mock.calls.at(-1) as [Record<string, unknown>, { where: unknown }];
      expect(values.estado).toBe('purgado');
      expect(values.updatedAtValue).toBeInstanceOf(Date);
      expect(opciones.where).toEqual({ tenantId: 't1', id: 'exp-1' });
    });

    it('el barrido de retención es global a propósito: lo corre un job, no un usuario', async () => {
      await repo.findExpedientesVencidos(50);

      const condicion = where(expedientes.findAll);
      expect(condicion).not.toHaveProperty('tenantId');
      expect((condicion.retencionHasta as Record<symbol, Date>)[Op.lt]).toBeInstanceOf(Date);
      expect(condicion.purgadoEn).toBeNull();
      expect((expedientes.findAll.mock.calls.at(-1)?.[0] as { limit: number }).limit).toBe(50);
    });
  });

  describe('nodos', () => {
    it('buscar un nodo por id acota por tenant y por expediente', async () => {
      await repo.findNodo('t1', 'exp-1', 'n1');
      expect(where(nodos.findOne)).toEqual({ tenantId: 't1', expedienteId: 'exp-1', id: 'n1' });
    });

    it('buscar por ruta ignora la papelera: un nombre borrado no debe bloquear el alta del nuevo', async () => {
      await repo.findNodoPorRuta('t1', 'exp-1', '/auth/carnet.jpg');
      expect(where(nodos.findOne)).toEqual({ tenantId: 't1', expedienteId: 'exp-1', ruta: '/auth/carnet.jpg', borradoEn: null });
    });

    it('el conteo por clave cruza tenants —el objeto es compartido— y sabe excluirse a sí mismo', async () => {
      await repo.contarNodosPorClave('k/a.jpg');
      expect(where(nodos.count)).toEqual({ storageKey: 'k/a.jpg' });

      await repo.contarNodosPorClave('k/a.jpg', 'n-42');
      const condicion = where(nodos.count);
      expect(condicion).not.toHaveProperty('tenantId');
      expect((condicion.id as Record<symbol, string>)[Op.ne]).toBe('n-42');
    });

    it('listar hijos navega por carpeta y esconde la papelera', async () => {
      await repo.listarHijos({ tenantId: 't1', expedienteId: 'exp-1', parentId: 'c-auth', incluirPapelera: false });
      expect(where(nodos.findAll)).toEqual({ tenantId: 't1', expedienteId: 'exp-1', parentId: 'c-auth', borradoEn: null });
    });

    it('con búsqueda se ignora la carpeta —se quiere el archivo, no navegar— y el comodín va escapado', async () => {
      await repo.listarHijos({ tenantId: 't1', expedienteId: 'exp-1', parentId: 'c-auth', incluirPapelera: true, q: '50%' });

      const condicion = where(nodos.findAll);
      expect(condicion).not.toHaveProperty('parentId');
      expect(condicion).not.toHaveProperty('borradoEn');
      expect((condicion.nombre as Record<symbol, string>)[Op.iLike]).toBe('%50\\%%');
    });

    it('listar todos incluye la papelera sólo si se pide', async () => {
      await repo.listarTodosLosNodos('t1', 'exp-1');
      expect(where(nodos.findAll)).toEqual({ tenantId: 't1', expedienteId: 'exp-1', borradoEn: null });

      await repo.listarTodosLosNodos('t1', 'exp-1', true);
      expect(where(nodos.findAll)).toEqual({ tenantId: 't1', expedienteId: 'exp-1' });
    });

    it('los ancestros salen de una sola consulta por prefijo, con la raíz y sin el propio nodo', async () => {
      await repo.findAncestros('t1', 'exp-1', '/auth/identidad/carnet.jpg');

      expect(nodos.findAll).toHaveBeenCalledTimes(1);
      expect((where(nodos.findAll).ruta as Record<symbol, string[]>)[Op.in]).toEqual(['', '/auth', '/auth/identidad']);
    });

    it('un nodo en la raíz sólo tiene a la raíz por ancestro', async () => {
      await repo.findAncestros('t1', 'exp-1', '/carnet.jpg');
      expect((where(nodos.findAll).ruta as Record<symbol, string[]>)[Op.in]).toEqual(['']);
    });

    it('el subárbol coge el nodo y sus descendientes, y `/auth` no arrastra a `/authority`', async () => {
      await repo.findSubarbol('t1', 'exp-1', '/auth');

      const condiciones = where(nodos.findAll)[Op.or] as [{ ruta: string }, { ruta: Record<symbol, string> }];
      expect(condiciones[0]).toEqual({ ruta: '/auth' });
      expect(condiciones[1].ruta[Op.like]).toBe('/auth/%');
    });

    it('el prefijo del subárbol va escapado: un `%` en el nombre de una carpeta borraría lo de al lado', async () => {
      await repo.findSubarbol('t1', 'exp-1', '/otros/100%');

      const condiciones = where(nodos.findAll)[Op.or] as [unknown, { ruta: Record<symbol, string> }];
      expect(condiciones[1].ruta[Op.like]).toBe('/otros/100\\%/%');
    });

    it('actualizar un nodo no exige el expediente pero sí el tenant, y sella `updated_at`', async () => {
      await repo.actualizarNodo('t1', 'n1', { inmutable: true });

      const [values, opciones] = nodos.update.mock.calls.at(-1) as [Record<string, unknown>, { where: unknown }];
      expect(values.inmutable).toBe(true);
      expect(values.updatedAtValue).toBeInstanceOf(Date);
      expect(opciones.where).toEqual({ tenantId: 't1', id: 'n1' });
    });

    it('el borrado definitivo propaga la transacción de quien purga', async () => {
      const transaction = {} as never;
      await repo.borrarNodoDefinitivo('t1', 'n1', transaction);

      expect(nodos.destroy).toHaveBeenCalledWith({ where: { tenantId: 't1', id: 'n1' }, transaction });
    });

    it('la papelera vencida se mide por días desde el borrado y es global: la barre un job', async () => {
      const antes = Date.now();
      await repo.findPapeleraVencida(30, 100);

      const corte = (where(nodos.findAll).borradoEn as Record<symbol, Date>)[Op.lt];
      expect(where(nodos.findAll)).not.toHaveProperty('tenantId');
      expect(antes - corte.getTime()).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1000);
    });

    it('la papelera que se enseña sí es por tenant y trae lo borrado más reciente primero', async () => {
      await repo.listarPapelera('t1', 25);

      const llamada = nodos.findAll.mock.calls.at(-1)?.[0] as { where: Record<string, unknown>; order: unknown[]; limit: number };
      expect(llamada.where.tenantId).toBe('t1');
      expect((llamada.where.borradoEn as Record<symbol, null>)[Op.ne]).toBeNull();
      expect(llamada.order).toEqual([['borrado_en', 'DESC']]);
      expect(llamada.limit).toBe(25);
    });
  });

  describe('actividad', () => {
    it('sin detalle escribe un objeto vacío y no un nulo: la columna se consulta con `->>`', async () => {
      await repo.registrar({
        tenantId: 't1',
        expedienteId: 'exp-1',
        nodoId: null,
        accion: 'ver',
        actorTipo: 'internal_user',
        actorId: '7',
      });

      expect(actividad.create).toHaveBeenCalledWith(expect.objectContaining({ detalle: {} }), { transaction: undefined });
    });

    it('la bitácora se filtra por nodo sólo cuando se pide, y sale de lo más nuevo a lo más viejo', async () => {
      await repo.listarActividad({ tenantId: 't1', expedienteId: 'exp-1', offset: 0, limit: 50 });
      expect(where(actividad.findAndCountAll)).toEqual({ tenantId: 't1', expedienteId: 'exp-1' });

      await repo.listarActividad({ tenantId: 't1', expedienteId: 'exp-1', nodoId: 'n1', offset: 0, limit: 50 });
      expect(where(actividad.findAndCountAll)).toEqual({ tenantId: 't1', expedienteId: 'exp-1', nodoId: 'n1' });
      expect((actividad.findAndCountAll.mock.calls.at(-1)?.[0] as { order: unknown[] }).order).toEqual([['created_at', 'DESC']]);
    });

    it('el aviso del formulario de decisión cuenta sólo las aperturas reales: ver y descargar', async () => {
      await repo.contarConsultas('t1', 'exp-1', '7');

      const condicion = where(actividad.count);
      expect(condicion.tenantId).toBe('t1');
      expect(condicion.actorId).toBe('7');
      expect((condicion.accion as Record<symbol, string[]>)[Op.in]).toEqual(['ver', 'descargar']);
    });
  });
});
