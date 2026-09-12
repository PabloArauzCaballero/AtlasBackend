import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Response } from 'express';
import { ExpedientesNodosController } from '../../../src/modules/expedientes/expedientes-nodos.controller.js';
import type { NodoService } from '../../../src/modules/expedientes/application/nodo.service.js';
import type { NodoMovimientoService } from '../../../src/modules/expedientes/application/nodo-movimiento.service.js';
import type { ContenidoService } from '../../../src/modules/expedientes/application/contenido.service.js';
import type { SubidaService } from '../../../src/modules/expedientes/application/subida.service.js';
import type { ExpedienteService } from '../../../src/modules/expedientes/application/expediente.service.js';
import type { ConcesionService } from '../../../src/modules/expedientes/application/concesion.service.js';
import type { ContactosService } from '../../../src/modules/expedientes/application/contactos.service.js';
import type { ActorExpediente } from '../../../src/modules/expedientes/expedientes.types.js';

/**
 * El árbol del expediente por HTTP.
 *
 * Tres decisiones que sólo se ven aquí.
 *
 * Los bytes de un archivo salen con `no-store` y no con una caché privada: es la cara o el documento
 * de identidad de una persona, y una copia en el disco del navegador de quien revisa sobrevive a que
 * se le retire el acceso. El nombre del adjunto se sanea OTRA VEZ al ponerlo en la cabecera, porque
 * una comilla partiría el valor.
 *
 * El nivel de cada hijo se resuelve con el del expediente ya calculado por el guard: recalcular uno
 * por fila haría tantas consultas de concesiones como archivos tenga la carpeta.
 *
 * Y la purga desde esta ruta es SIEMPRE `soloPapelera: true`, aunque exija nivel de administrar:
 * vaciar la papelera y purgar el expediente entero son operaciones distintas, y la segunda no se
 * dispara desde el botón de la primera.
 */
const ACTOR: ActorExpediente = { tipo: 'internal_user', id: '7', roles: [], permisos: [] };

function peticion(nivel = 'escribir') {
  return { expediente: { actor: ACTOR, nivel }, ip: '10.0.0.1', correlationId: 'req-1' } as never;
}

function nodo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    expedienteId: 'exp-1',
    parentId: null,
    tipo: 'archivo',
    nombre: 'carnet.jpg',
    ruta: '/auth/carnet.jpg',
    clase: 'identity_front',
    origen: 'onboarding',
    mimeType: 'image/jpeg',
    sizeBytes: '100',
    sha256: 'h1',
    inmutable: false,
    virtual: false,
    objetoAusente: false,
    borradoEn: null,
    createdAtValue: new Date('2026-09-01T10:00:00Z'),
    updatedAtValue: new Date('2026-09-02T10:00:00Z'),
    ...overrides,
  };
}

function respuesta(): Response & { cabeceras: Record<string, string>; cuerpo: unknown } {
  const cabeceras: Record<string, string> = {};
  let cuerpo: unknown = null;
  return {
    cabeceras,
    get cuerpo() {
      return cuerpo;
    },
    setHeader: (clave: string, valor: string) => {
      cabeceras[clave] = valor;
    },
    end: (bytes: unknown) => {
      cuerpo = bytes;
    },
  } as unknown as Response & { cabeceras: Record<string, string>; cuerpo: unknown };
}

describe('ExpedientesNodosController', () => {
  let nodos: { listarHijos: jest.Mock; obtenerNodo: jest.Mock; crearCarpeta: jest.Mock };
  let movimiento: { renombrar: jest.Mock; mover: jest.Mock; borrar: jest.Mock; restaurar: jest.Mock };
  let contenido: { leer: jest.Mock };
  let subidas: { emitirTicket: jest.Mock; confirmar: jest.Mock };
  let expedientes: { purgar: jest.Mock };
  let controller: ExpedientesNodosController;

  beforeEach(() => {
    nodos = {
      listarHijos: jest.fn(async () => []),
      obtenerNodo: jest.fn(async () => nodo()),
      crearCarpeta: jest.fn(async () => nodo({ tipo: 'carpeta', nombre: 'nueva' })),
    };
    movimiento = {
      renombrar: jest.fn(async () => undefined),
      mover: jest.fn(async () => undefined),
      borrar: jest.fn(async () => 4),
      restaurar: jest.fn(async () => undefined),
    };
    contenido = { leer: jest.fn(async () => ({ contentType: 'image/jpeg', bytes: Buffer.from('bytes'), nombre: 'carnet.jpg' })) };
    subidas = {
      emitirTicket: jest.fn(async () => ({ ticketId: 'tk-1', url: 'https://minio/put' })),
      confirmar: jest.fn(async () => nodo()),
    };
    expedientes = { purgar: jest.fn(async () => ({ nodos: 2, objetosBorrados: 1, objetosConservados: 1 })) };

    controller = new ExpedientesNodosController(
      nodos as unknown as NodoService,
      movimiento as unknown as NodoMovimientoService,
      contenido as unknown as ContenidoService,
      subidas as unknown as SubidaService,
      expedientes as unknown as ExpedienteService,
      {} as unknown as ConcesionService,
      {} as unknown as ContactosService,
    );
  });

  describe('listar', () => {
    it('el nivel de cada hijo sale del expediente ya calculado, sin una consulta por fila', async () => {
      nodos.listarHijos.mockResolvedValueOnce([nodo({ id: 'a' }), nodo({ id: 'b' })] as never);

      const hijos = await controller.listar('t1', { id: 'exp-1' } as never, { incluirPapelera: false } as never, peticion('leer'));

      expect(hijos.map((h) => h.nivelEfectivo)).toEqual(['leer', 'leer']);
    });

    it('la carpeta, la papelera y el buscador viajan al servicio tal cual', async () => {
      await controller.listar(
        't1',
        { id: 'exp-1' } as never,
        { parentId: 'c-auth', incluirPapelera: true, q: 'carnet' } as never,
        peticion(),
      );

      expect(nodos.listarHijos).toHaveBeenCalledWith({
        tenantId: 't1',
        expedienteId: 'exp-1',
        parentId: 'c-auth',
        incluirPapelera: true,
        q: 'carnet',
      });
    });

    it('sin carpeta indicada se pide la raíz y no `undefined`', async () => {
      await controller.listar('t1', { id: 'exp-1' } as never, { incluirPapelera: false } as never, peticion());

      expect(nodos.listarHijos).toHaveBeenCalledWith(expect.objectContaining({ parentId: null }));
    });
  });

  describe('contenido de un archivo', () => {
    it('escribe el tipo real y el tamaño, y el ETag sale del hash del contenido', async () => {
      const res = respuesta();

      await controller.obtenerContenido('t1', { id: 'exp-1', nodoId: 'n1' } as never, {} as never, peticion('leer'), res);

      expect(res.cabeceras['Content-Type']).toBe('image/jpeg');
      expect(res.cabeceras['Content-Length']).toBe('5');
      expect(res.cabeceras.ETag).toBe('"h1"');
      expect(res.cuerpo).toEqual(Buffer.from('bytes'));
    });

    it('un archivo sin hash no lleva ETag inventado', async () => {
      nodos.obtenerNodo.mockResolvedValueOnce(nodo({ sha256: null }) as never);
      const res = respuesta();

      await controller.obtenerContenido('t1', { id: 'exp-1', nodoId: 'n1' } as never, {} as never, peticion('leer'), res);

      expect(res.cabeceras).not.toHaveProperty('ETag');
    });

    it('ver no es descargar: sin `attachment` no se manda `Content-Disposition`', async () => {
      const res = respuesta();

      await controller.obtenerContenido('t1', { id: 'exp-1', nodoId: 'n1' } as never, {} as never, peticion('leer'), res);

      expect(res.cabeceras).not.toHaveProperty('Content-Disposition');
      expect(contenido.leer).toHaveBeenCalledWith(expect.objectContaining({ descarga: false }));
    });

    it('el nombre del adjunto se sanea otra vez: una comilla partiría la cabecera', async () => {
      contenido.leer.mockResolvedValueOnce({
        contentType: 'application/pdf',
        bytes: Buffer.from('x'),
        nombre: 'informe "raro"\\final.pdf',
      } as never);
      const res = respuesta();

      await controller.obtenerContenido(
        't1',
        { id: 'exp-1', nodoId: 'n1' } as never,
        { disposition: 'attachment' } as never,
        peticion('leer'),
        res,
      );

      expect(res.cabeceras['Content-Disposition']).toBe('attachment; filename="informe rarofinal.pdf"');
    });

    it('la lectura queda registrada con quién, desde dónde y con qué petición', async () => {
      await controller.obtenerContenido('t1', { id: 'exp-1', nodoId: 'n1' } as never, {} as never, peticion('leer'), respuesta());

      expect(contenido.leer).toHaveBeenCalledWith(
        expect.objectContaining({ actor: ACTOR, ip: '10.0.0.1', requestId: 'req-1', expedienteId: 'exp-1' }),
      );
    });
  });

  describe('crear y subir', () => {
    it('una carpeta nueva nace bajo la raíz cuando no se indica padre', async () => {
      await controller.crearCarpeta('t1', { id: 'exp-1' } as never, { nombre: 'nueva' } as never, peticion());

      expect(nodos.crearCarpeta).toHaveBeenCalledWith(expect.objectContaining({ parentId: null, nombre: 'nueva', actor: ACTOR }));
    });

    it('el ticket de subida lleva el hash y el tamaño declarados: la confirmación los verificará', async () => {
      const ticket = await controller.crearSubida(
        't1',
        { id: 'exp-1' } as never,
        { nombre: 'a.pdf', contentType: 'application/pdf', sizeBytes: 1024, sha256: 'h1' } as never,
        peticion(),
      );

      expect(subidas.emitirTicket).toHaveBeenCalledWith(
        expect.objectContaining({ sha256: 'h1', sizeBytes: 1024, contentType: 'application/pdf', parentId: null }),
      );
      expect(ticket).toMatchObject({ ticketId: 'tk-1' });
    });

    it('confirmar devuelve el nodo ya en el expediente, con el nivel de quien pregunta', async () => {
      const dto = await controller.confirmarSubida('t1', { id: 'exp-1' } as never, 'tk-1', peticion('administrar'));

      expect(subidas.confirmar).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'tk-1', expedienteId: 'exp-1' }));
      expect(dto.nivelEfectivo).toBe('administrar');
    });
  });

  describe('renombrar, mover, borrar y restaurar', () => {
    it('sólo se renombra si llegó un nombre, y sólo se mueve si llegó un destino', async () => {
      await controller.actualizar('t1', { id: 'exp-1', nodoId: 'n1' } as never, { nombre: 'otro.jpg' } as never, peticion());
      expect(movimiento.renombrar).toHaveBeenCalled();
      expect(movimiento.mover).not.toHaveBeenCalled();

      movimiento.renombrar.mockClear();
      await controller.actualizar('t1', { id: 'exp-1', nodoId: 'n1' } as never, { parentId: 'c-otros' } as never, peticion());
      expect(movimiento.renombrar).not.toHaveBeenCalled();
      expect(movimiento.mover).toHaveBeenCalledWith(expect.objectContaining({ destinoId: 'c-otros' }));
    });

    it('al mover tras renombrar se relee el nodo: su ruta ya cambió', async () => {
      await controller.actualizar(
        't1',
        { id: 'exp-1', nodoId: 'n1' } as never,
        { nombre: 'otro.jpg', parentId: 'c-otros' } as never,
        peticion(),
      );

      expect(nodos.obtenerNodo).toHaveBeenCalledTimes(3);
    });

    it('mover a la raíz es un destino válido, no «sin destino»', async () => {
      await controller.actualizar('t1', { id: 'exp-1', nodoId: 'n1' } as never, { parentId: null } as never, peticion());

      expect(movimiento.mover).toHaveBeenCalledWith(expect.objectContaining({ destinoId: null }));
    });

    it('borrar declara cuántos nodos arrastró: una carpeta se lleva su contenido', async () => {
      await expect(controller.borrar('t1', { id: 'exp-1', nodoId: 'n1' } as never, peticion())).resolves.toEqual({ nodosEnPapelera: 4 });
    });

    it('restaurar devuelve el nodo releído, con su ruta ya recalculada', async () => {
      const dto = await controller.restaurar('t1', { id: 'exp-1', nodoId: 'n1' } as never, peticion());

      expect(movimiento.restaurar).toHaveBeenCalledWith(expect.objectContaining({ nodo: expect.anything(), actor: ACTOR }));
      expect(dto.ruta).toBe('/auth/carnet.jpg');
    });
  });

  describe('vaciar la papelera', () => {
    it('SIEMPRE es sólo la papelera: purgar el expediente entero no se dispara desde este botón', async () => {
      await controller.purgar('t1', { id: 'exp-1' } as never, { motivo: 'limpieza' } as never, peticion('administrar'));

      expect(expedientes.purgar).toHaveBeenCalledWith({
        tenantId: 't1',
        expedienteId: 'exp-1',
        actor: ACTOR,
        motivo: 'limpieza',
        soloPapelera: true,
      });
    });

    it('devuelve el recuento de lo borrado y lo conservado, no un simple «ok»', async () => {
      const resultado = await controller.purgar('t1', { id: 'exp-1' } as never, { motivo: 'limpieza' } as never, peticion('administrar'));

      expect(resultado).toEqual({ nodos: 2, objetosBorrados: 1, objetosConservados: 1 });
    });
  });
});
