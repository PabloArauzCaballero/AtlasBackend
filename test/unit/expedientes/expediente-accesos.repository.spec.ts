import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { ExpedienteAccesosRepository } from '../../../src/modules/expedientes/repositories/expediente-accesos.repository.js';
import type { ExpedienteConcesionModel, ExpedienteTicketSubidaModel } from '../../../src/database/models/index.js';

/**
 * Las dos tablas que AUTORIZAN, no las que guardan.
 *
 * Una concesión dice quién puede ver una carpeta; un ticket dice que una subida concreta está
 * permitida durante unos minutos. Lo que se fija es qué cuenta como «vigente» en cada una, porque
 * es lo único que separa un permiso de un permiso caducado — y las dos formas de romperlo son
 * silenciosas.
 *
 * Una concesión vigente es la NO revocada y, o bien sin caducidad, o bien con la caducidad todavía
 * por delante. Olvidar `revocadoEn` deja entrando a quien ya se le quitó el acceso; olvidar la
 * caducidad convierte un permiso temporal —«míralo esta semana»— en uno permanente.
 *
 * Un ticket vencido es el NO consumido cuya fecha ya pasó: incluir los consumidos haría que la
 * limpieza borrase el objeto de una subida que sí llegó a completarse.
 *
 * Y una lista vacía de nodos no consulta: un `IN ()` vacío traería todas las concesiones del tenant.
 */
type Doble = { create: jest.Mock; findOne: jest.Mock; findAll: jest.Mock; update: jest.Mock; destroy: jest.Mock };

function doble(): Doble {
  return {
    create: jest.fn(async (values: unknown) => values),
    findOne: jest.fn(async () => null),
    findAll: jest.fn(async () => []),
    update: jest.fn(async () => [1]),
    destroy: jest.fn(async () => 1),
  };
}

function ultima(mock: jest.Mock): { where: Record<string | symbol, unknown>; limit?: number; transaction?: unknown } {
  return mock.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> };
}

describe('ExpedienteAccesosRepository', () => {
  let concesiones: Doble;
  let tickets: Doble;
  let repo: ExpedienteAccesosRepository;
  const tx = {} as never;

  beforeEach(() => {
    concesiones = doble();
    tickets = doble();
    repo = new ExpedienteAccesosRepository(
      concesiones as unknown as typeof ExpedienteConcesionModel,
      tickets as unknown as typeof ExpedienteTicketSubidaModel,
    );
  });

  describe('concesiones', () => {
    it('se crea con su motivo y su caducidad, dentro de la transacción de quien concede', async () => {
      await repo.crearConcesion(
        {
          tenantId: 't1',
          nodoId: 'n-1',
          principalTipo: 'internal_user',
          principalId: '7',
          nivel: 'leer',
          otorgadoPorId: '9',
          motivo: 'revisión de fraude',
          venceEn: new Date('2026-09-17T10:00:00Z'),
        },
        tx,
      );

      expect(concesiones.create).toHaveBeenCalledWith(expect.objectContaining({ nivel: 'leer', motivo: 'revisión de fraude' }), {
        transaction: tx,
      });
    });

    it('«vigente» exige NO revocada: olvidarlo deja entrando a quien ya perdió el acceso', async () => {
      await repo.findConcesionesVigentes('t1', ['n-1', 'n-2']);

      const condicion = ultima(concesiones.findAll).where;
      expect(condicion.tenantId).toBe('t1');
      expect(condicion.revocadoEn).toBeNull();
      expect((condicion.nodoId as Record<symbol, string[]>)[Op.in]).toEqual(['n-1', 'n-2']);
    });

    it('«vigente» acepta sin caducidad o con la caducidad por delante, no cualquiera', async () => {
      const antes = Date.now();
      await repo.findConcesionesVigentes('t1', ['n-1']);

      const [sinCaducidad, porDelante] = ultima(concesiones.findAll).where[Op.or] as [{ venceEn: null }, { venceEn: Record<symbol, Date> }];
      expect(sinCaducidad).toEqual({ venceEn: null });
      expect((porDelante.venceEn as Record<symbol, Date>)[Op.gt].getTime()).toBeGreaterThanOrEqual(antes);
    });

    it('se consulta el nodo Y sus ancestros de una vez: la herencia de permisos no es una consulta por nivel', async () => {
      await repo.findConcesionesVigentes('t1', ['', '/auth', '/auth/identidad']);

      expect(concesiones.findAll).toHaveBeenCalledTimes(1);
      expect((ultima(concesiones.findAll).where.nodoId as Record<symbol, string[]>)[Op.in]).toHaveLength(3);
    });

    it('sin nodos no se consulta: un `IN ()` vacío traería todas las del tenant', async () => {
      await expect(repo.findConcesionesVigentes('t1', [])).resolves.toEqual([]);
      expect(concesiones.findAll).not.toHaveBeenCalled();
    });

    it('leer una concesión por id exige el tenant', async () => {
      await repo.findConcesion('t1', 'g-1');

      expect(ultima(concesiones.findOne).where).toEqual({ tenantId: 't1', id: 'g-1' });
    });

    it('revocar no borra: deja escrito cuándo y quién', async () => {
      await repo.revocarConcesion('t1', 'g-1', '9');

      const [values, opciones] = concesiones.update.mock.calls.at(-1) as [Record<string, unknown>, { where: unknown }];
      expect(values.revocadoEn).toBeInstanceOf(Date);
      expect(values.revocadoPorId).toBe('9');
      expect(opciones.where).toEqual({ tenantId: 't1', id: 'g-1' });
      expect(concesiones.destroy).not.toHaveBeenCalled();
    });

    it('una revocación automática se declara sin autor en vez de atribuirse a alguien', async () => {
      await repo.revocarConcesion('t1', 'g-1', null);

      expect((concesiones.update.mock.calls.at(-1)?.[0] as { revocadoPorId: unknown }).revocadoPorId).toBeNull();
    });
  });

  describe('tickets de subida', () => {
    it('el ticket guarda lo PREVISTO —nombre, tipo, tamaño y hash— y la clave que impuso el servidor', async () => {
      const vence = new Date('2026-09-10T10:15:00Z');

      await repo.crearTicket({
        tenantId: 't1',
        expedienteId: 'exp-1',
        parentId: null,
        nombrePrevisto: 'carnet.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: '2048',
        sha256Declarado: 'h1',
        storageKey: 'k/uuid.jpg',
        emitidoPorId: '7',
        venceEn: vence,
      });

      expect(tickets.create).toHaveBeenCalledWith(
        expect.objectContaining({ nombrePrevisto: 'carnet.jpg', sha256Declarado: 'h1', storageKey: 'k/uuid.jpg', venceEn: vence }),
      );
    });

    it('leerlo exige el tenant: un identificador de ticket ajeno no debe resolverse', async () => {
      await repo.findTicket('t1', 'tk-1');

      expect(ultima(tickets.findOne).where).toEqual({ tenantId: 't1', id: 'tk-1' });
    });

    it('consumirlo lo sella y no lo borra: la subida completada deja rastro', async () => {
      await repo.consumirTicket('t1', 'tk-1', tx);

      const [values, opciones] = tickets.update.mock.calls.at(-1) as [Record<string, unknown>, { where: unknown; transaction: unknown }];
      expect(values.consumidoEn).toBeInstanceOf(Date);
      expect(opciones.where).toEqual({ tenantId: 't1', id: 'tk-1' });
      expect(opciones.transaction).toBe(tx);
    });

    it('«vencido» es NO consumido y con la fecha ya pasada: incluir los consumidos borraría subidas buenas', async () => {
      const antes = Date.now();
      await repo.findTicketsVencidos(200);

      const condicion = ultima(tickets.findAll).where;
      expect(condicion.consumidoEn).toBeNull();
      expect((condicion.venceEn as Record<symbol, Date>)[Op.lt].getTime()).toBeGreaterThanOrEqual(antes);
      expect(ultima(tickets.findAll).limit).toBe(200);
    });

    it('el barrido de vencidos es GLOBAL a propósito: lo corre un job, no un usuario', async () => {
      await repo.findTicketsVencidos(50);

      expect(ultima(tickets.findAll).where).not.toHaveProperty('tenantId');
    });

    it('borrar un ticket lo quita de verdad: no guarda nada personal, sólo una autorización caducada', async () => {
      await repo.borrarTicket('tk-1');

      expect(tickets.destroy).toHaveBeenCalledWith({ where: { id: 'tk-1' } });
    });
  });
});
