import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ExpedientesController } from '../../../src/modules/expedientes/expedientes.controller.js';
import type { ExpedienteService } from '../../../src/modules/expedientes/application/expediente.service.js';
import type { ConcesionService } from '../../../src/modules/expedientes/application/concesion.service.js';
import type { ExpedientesRepository } from '../../../src/modules/expedientes/repositories/expedientes.repository.js';
import type { ExpedienteModel } from '../../../src/database/models/index.js';
import type { ActorExpediente } from '../../../src/modules/expedientes/expedientes.types.js';

/**
 * Las cuatro lecturas del expediente.
 *
 * Lo que se fija aquí son las decisiones del controlador que ninguna prueba del servicio alcanza.
 * La primera: un sujeto SIN expediente responde 200 con `null` y no 404 —«este cliente no tiene
 * carpeta» es una respuesta legítima que la pantalla pinta como estado vacío, no como un error—, y
 * lo mismo cuando el actor no alcanza ningún nivel sobre ella: se contesta `null` en vez de un 403,
 * porque un 403 confirmaría que existe. La segunda: el tamaño que se enseña cuenta sólo ARCHIVOS,
 * no las carpetas, y una fila sin tamaño suma cero en vez de convertir el total en NaN. La tercera:
 * la aritmética de páginas, que es la que decide si el usuario ve el botón de «siguiente» —una
 * página de más deja una pantalla vacía al final; una de menos esconde filas sin avisar—.
 */
const ACTOR: ActorExpediente = { tipo: 'internal_user', id: '7', roles: [], permisos: [] };

function peticion(nivel: string | null = 'leer') {
  return { expediente: { actor: ACTOR, nivel } } as never;
}

function expediente(overrides: Record<string, unknown> = {}): ExpedienteModel {
  return {
    id: 'exp-1',
    subjectType: 'customer',
    subjectId: 'c1',
    sessionId: null,
    customerCode: 'CLI-1',
    estado: 'abierto',
    enviadoEn: null,
    manifestNodoId: null,
    retencionHasta: null,
    purgadoEn: null,
    createdAtValue: new Date('2026-09-01T10:00:00Z'),
    ...overrides,
  } as unknown as ExpedienteModel;
}

function nodo(overrides: Record<string, unknown> = {}) {
  return { id: 'n1', tipo: 'archivo', sizeBytes: '100', ...overrides };
}

describe('ExpedientesController', () => {
  let expedientes: { listar: jest.Mock; porSujeto: jest.Mock; obtener: jest.Mock };
  let concesiones: { nivelBase: jest.Mock; resolver: jest.Mock };
  let repository: { listarTodosLosNodos: jest.Mock; listarActividad: jest.Mock };
  let controller: ExpedientesController;

  beforeEach(() => {
    expedientes = {
      listar: jest.fn(async () => ({ rows: [], count: 0 })),
      porSujeto: jest.fn(async () => null),
      obtener: jest.fn(async () => expediente()),
    };
    concesiones = { nivelBase: jest.fn(() => 'leer'), resolver: jest.fn(async () => 'leer') };
    repository = {
      listarTodosLosNodos: jest.fn(async () => []),
      listarActividad: jest.fn(async () => ({ rows: [], count: 0 })),
    };
    controller = new ExpedientesController(
      expedientes as unknown as ExpedienteService,
      concesiones as unknown as ConcesionService,
      repository as unknown as ExpedientesRepository,
    );
  });

  describe('listado', () => {
    it('traduce página y tamaño a desplazamiento y tope', async () => {
      await controller.listar('t1', { page: 3, pageSize: 20 } as never, peticion());

      expect(expedientes.listar).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', offset: 40, limit: 20 }));
    });

    it('cuenta sólo archivos y suma sus bytes; una carpeta o una fila sin tamaño no alteran el total', async () => {
      expedientes.listar.mockResolvedValueOnce({ rows: [expediente()], count: 1 } as never);
      repository.listarTodosLosNodos.mockResolvedValueOnce([
        nodo({ id: 'a', sizeBytes: '100' }),
        nodo({ id: 'b', sizeBytes: null }),
        nodo({ id: 'c', tipo: 'carpeta', sizeBytes: '999' }),
      ] as never);

      const pagina = await controller.listar('t1', { page: 1, pageSize: 20 } as never, peticion());

      expect(pagina.items[0].nodosTotal).toBe(2);
      expect(pagina.items[0].bytesTotal).toBe('1099');
    });

    it('el nivel del listado es el BASE del actor: resolver uno por expediente sería una consulta por fila', async () => {
      expedientes.listar.mockResolvedValueOnce({ rows: [expediente()], count: 1 } as never);

      const pagina = await controller.listar('t1', { page: 1, pageSize: 20 } as never, peticion());

      expect(concesiones.nivelBase).toHaveBeenCalledWith(ACTOR);
      expect(concesiones.resolver).not.toHaveBeenCalled();
      expect(pagina.items[0].nivelEfectivo).toBe('leer');
    });

    it('la aritmética de páginas decide el botón de «siguiente» y nunca declara cero páginas', async () => {
      expedientes.listar.mockResolvedValueOnce({ rows: [], count: 45 } as never);
      const media = await controller.listar('t1', { page: 2, pageSize: 20 } as never, peticion());
      expect(media).toMatchObject({ total: 45, totalPages: 3, hasNextPage: true });

      expedientes.listar.mockResolvedValueOnce({ rows: [], count: 45 } as never);
      const ultima = await controller.listar('t1', { page: 3, pageSize: 20 } as never, peticion());
      expect(ultima.hasNextPage).toBe(false);

      expedientes.listar.mockResolvedValueOnce({ rows: [], count: 0 } as never);
      const vacia = await controller.listar('t1', { page: 1, pageSize: 20 } as never, peticion());
      expect(vacia).toMatchObject({ totalPages: 1, hasNextPage: false });
    });

    it('los filtros del buscador llegan al servicio tal cual', async () => {
      await controller.listar('t1', { page: 1, pageSize: 20, subjectType: 'partner', estado: 'enviado', q: 'CLI' } as never, peticion());

      expect(expedientes.listar).toHaveBeenCalledWith(expect.objectContaining({ subjectType: 'partner', estado: 'enviado', q: 'CLI' }));
    });
  });

  describe('por sujeto', () => {
    it('un sujeto sin expediente responde null y no 404: la pantalla lo pinta como estado vacío', async () => {
      await expect(
        controller.porSujeto('t1', { subjectType: 'customer', subjectId: 'c1' } as never, undefined, peticion()),
      ).resolves.toBeNull();
      expect(concesiones.resolver).not.toHaveBeenCalled();
    });

    it('sin nivel sobre la carpeta también responde null: un 403 confirmaría que existe', async () => {
      expedientes.porSujeto.mockResolvedValueOnce(expediente() as never);
      concesiones.resolver.mockResolvedValueOnce(null as never);

      await expect(
        controller.porSujeto('t1', { subjectType: 'customer', subjectId: 'c1' } as never, undefined, peticion()),
      ).resolves.toBeNull();
      expect(repository.listarTodosLosNodos).not.toHaveBeenCalled();
    });

    it('la sesión es opcional y viaja como nulo cuando no llega', async () => {
      await controller.porSujeto('t1', { subjectType: 'customer', subjectId: 'c1' } as never, undefined, peticion());
      expect(expedientes.porSujeto).toHaveBeenCalledWith('t1', 'customer', 'c1', null);

      await controller.porSujeto('t1', { subjectType: 'customer', subjectId: 'c1' } as never, 's9', peticion());
      expect(expedientes.porSujeto).toHaveBeenCalledWith('t1', 'customer', 'c1', 's9');
    });

    it('el nivel se resuelve por expediente y se avisa si ya está purgado', async () => {
      expedientes.porSujeto.mockResolvedValueOnce(expediente({ purgadoEn: new Date('2026-09-05T10:00:00Z') }) as never);

      const dto = await controller.porSujeto('t1', { subjectType: 'customer', subjectId: 'c1' } as never, undefined, peticion());

      expect(concesiones.resolver).toHaveBeenCalledWith(
        expect.objectContaining({ expedienteId: 'exp-1', ruta: '', expedientePurgado: true }),
      );
      expect(dto?.purgadoEn).toBe('2026-09-05T10:00:00.000Z');
    });
  });

  describe('detalle', () => {
    it('el nivel efectivo sale del guardián, ya resuelto para esta petición', async () => {
      repository.listarTodosLosNodos.mockResolvedValueOnce([nodo({ sizeBytes: '250' })] as never);

      const dto = await controller.obtener('t1', { id: 'exp-1' } as never, peticion('escribir'));

      expect(dto.nivelEfectivo).toBe('escribir');
      expect(dto.bytesTotal).toBe('250');
      expect(dto.expedienteId).toBe('exp-1');
    });

    it('un expediente sin manifiesto lo declara ausente en vez de omitir el campo', async () => {
      const dto = await controller.obtener('t1', { id: 'exp-1' } as never, peticion());
      expect(dto.manifestPresente).toBe(false);

      expedientes.obtener.mockResolvedValueOnce(expediente({ manifestNodoId: 'n-manifiesto' }) as never);
      const conManifiesto = await controller.obtener('t1', { id: 'exp-1' } as never, peticion());
      expect(conManifiesto.manifestPresente).toBe(true);
    });
  });

  describe('bitácora', () => {
    it('acota al expediente de la ruta y filtra por nodo sólo si se pide', async () => {
      await controller.actividad('t1', { id: 'exp-1' } as never, { page: 2, pageSize: 25 } as never);

      expect(repository.listarActividad).toHaveBeenCalledWith({
        tenantId: 't1',
        expedienteId: 'exp-1',
        nodoId: undefined,
        offset: 25,
        limit: 25,
      });
    });

    it('devuelve la bitácora ya mapeada, con la fecha en ISO', async () => {
      repository.listarActividad.mockResolvedValueOnce({
        rows: [
          {
            id: 'act-1',
            nodoId: null,
            accion: 'ver',
            actorTipo: 'internal_user',
            actorId: '7',
            detalle: { ruta: '/auth' },
            createdAtValue: new Date('2026-09-02T10:00:00Z'),
          },
        ],
        count: 1,
      } as never);

      const pagina = await controller.actividad('t1', { id: 'exp-1' } as never, { page: 1, pageSize: 25 } as never);

      expect(pagina.items[0]).toEqual({
        actividadId: 'act-1',
        nodoId: null,
        accion: 'ver',
        actorTipo: 'internal_user',
        actorId: '7',
        detalle: { ruta: '/auth' },
        ocurridoEn: '2026-09-02T10:00:00.000Z',
      });
      expect(pagina).toMatchObject({ total: 1, totalPages: 1, hasNextPage: false });
    });
  });
});
