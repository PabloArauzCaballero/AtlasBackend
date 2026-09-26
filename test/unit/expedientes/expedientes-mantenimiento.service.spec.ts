import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Sequelize } from 'sequelize-typescript';
import { ExpedientesMantenimientoService } from '../../../src/modules/expedientes/jobs/expedientes-mantenimiento.service.js';
import { env } from '../../../src/config/env.js';
import type { ExpedientesRepository } from '../../../src/modules/expedientes/repositories/expedientes.repository.js';
import type { ExpedienteAccesosRepository } from '../../../src/modules/expedientes/repositories/expediente-accesos.repository.js';
import type { ExpedienteService } from '../../../src/modules/expedientes/application/expediente.service.js';
import type { NodoService } from '../../../src/modules/expedientes/application/nodo.service.js';
import type { MaterializadorService } from '../../../src/modules/expedientes/application/materializador.service.js';
import type { ObjectRefCounterService } from '../../../src/modules/expedientes/application/object-ref-counter.service.js';
import type { DocumentStorageService } from '../../../src/common/storage/document-storage.service.js';
import type { ActorService } from '../../../src/modules/expedientes/application/actor.service.js';

/**
 * Los dos trabajos de fondo del expediente.
 *
 * El relleno existe porque el módulo nace con clientes que ya tienen documentos: sin él, un revisor
 * que abriera el caso de alguien de la semana pasada vería una carpeta vacía y concluiría que no
 * subió nada — la peor lectura posible, porque es indistinguible de la verdad para quien no sabe
 * cuándo se desplegó esto. Se fija que NO escriba manifiesto: un manifiesto es la foto de lo que
 * había AL ENVIAR, y esa foto no se observó; fabricarla ahora sería inventar evidencia con fecha
 * falsa. Y que un objeto que ya no está en el almacén se marque como AUSENTE en vez de dejar la
 * fila como si estuviera: es lo que permite que la pantalla diga «este archivo se perdió» en vez de
 * fallar al abrirlo, y que alguien pueda contarlos antes de que un revisor se tropiece con el
 * primero.
 *
 * La limpieza es el único sitio del módulo que borra bytes sin que una persona lo pida. Por eso
 * pasa por el mismo conteo de referencias que la purga manual y, ANTE LA DUDA, no borra: se
 * reintenta en la vuelta siguiente. Un huérfano cuesta unos kilobytes; un hueco en la evidencia de
 * una decisión no se repara.
 */
const ACTOR = { tipo: 'sistema', id: null } as never;

function nodoPapelera(overrides: Record<string, unknown> = {}) {
  return { id: 'n1', tenantId: 't1', storageKey: 'k/a.jpg', virtual: false, ...overrides };
}

describe('ExpedientesMantenimientoService', () => {
  let repository: {
    actualizarExpediente: jest.Mock;
    actualizarNodo: jest.Mock;
    findPapeleraVencida: jest.Mock;
    borrarNodoDefinitivo: jest.Mock;
    findExpedientesVencidos: jest.Mock;
  };
  let accesos: { findTicketsVencidos: jest.Mock; borrarTicket: jest.Mock };
  let expedientes: { abrir: jest.Mock; purgar: jest.Mock };
  let nodos: { registrarArchivo: jest.Mock };
  let materializador: { asegurarNodoDeContactos: jest.Mock; escribirManifiesto: jest.Mock };
  let refCounter: { contar: jest.Mock; puedeBorrarse: jest.Mock };
  let storage: { headObject: jest.Mock; deleteObject: jest.Mock; getBucket: jest.Mock };
  let actores: { sistema: jest.Mock };
  let query: jest.Mock;
  let service: ExpedientesMantenimientoService;
  let original: boolean;

  beforeEach(() => {
    original = env.EXPEDIENTES_ENABLED;
    (env as { EXPEDIENTES_ENABLED: boolean }).EXPEDIENTES_ENABLED = true;
    repository = {
      actualizarExpediente: jest.fn(async () => undefined),
      actualizarNodo: jest.fn(async () => undefined),
      findPapeleraVencida: jest.fn(async () => []),
      borrarNodoDefinitivo: jest.fn(async () => undefined),
      findExpedientesVencidos: jest.fn(async () => []),
    };
    accesos = { findTicketsVencidos: jest.fn(async () => []), borrarTicket: jest.fn(async () => undefined) };
    expedientes = { abrir: jest.fn(async () => ({ id: 'exp-1' })), purgar: jest.fn(async () => ({ objetosBorrados: 1 })) };
    nodos = { registrarArchivo: jest.fn(async () => ({ id: 'n1' })) };
    materializador = { asegurarNodoDeContactos: jest.fn(async () => undefined), escribirManifiesto: jest.fn(async () => undefined) };
    refCounter = { contar: jest.fn(async () => ({})), puedeBorrarse: jest.fn(() => true) };
    storage = {
      headObject: jest.fn(async () => ({ contentType: 'image/jpeg', sizeBytes: 100 })),
      deleteObject: jest.fn(async () => undefined),
      getBucket: jest.fn(() => 'atlas'),
    };
    actores = { sistema: jest.fn(() => ACTOR) };
    query = jest.fn(async () => []);

    service = new ExpedientesMantenimientoService(
      repository as unknown as ExpedientesRepository,
      accesos as unknown as ExpedienteAccesosRepository,
      expedientes as unknown as ExpedienteService,
      nodos as unknown as NodoService,
      materializador as unknown as MaterializadorService,
      refCounter as unknown as ObjectRefCounterService,
      storage as unknown as DocumentStorageService,
      actores as unknown as ActorService,
      { query } as unknown as Sequelize,
    );
  });

  afterEach(() => {
    (env as { EXPEDIENTES_ENABLED: boolean }).EXPEDIENTES_ENABLED = original;
  });

  function conClientes(clientes: unknown[], evidencias: unknown[] = []) {
    query.mockResolvedValueOnce(clientes as never);
    for (const _cliente of clientes) query.mockResolvedValueOnce(evidencias as never);
  }

  describe('relleno histórico', () => {
    it('con el módulo apagado no consulta nada', async () => {
      (env as { EXPEDIENTES_ENABLED: boolean }).EXPEDIENTES_ENABLED = false;

      await expect(service.rellenar()).resolves.toEqual({ clientes: 0, nodos: 0, sinObjeto: 0 });
      expect(query).not.toHaveBeenCalled();
    });

    it('sólo busca clientes SIN expediente: por eso se puede relanzar sin duplicar', async () => {
      await service.rellenar(50);

      const [sql, opciones] = query.mock.calls[0] as [string, { replacements: Record<string, unknown> }];
      expect(sql).toContain('NOT EXISTS');
      expect(opciones.replacements).toEqual({ limite: 50 });
    });

    it('abre sin sesión: atarlo a una equivocada sería peor que dejarlo nulo', async () => {
      conClientes([{ customerId: 'c1', tenantId: 't1', customerCode: 'CLI-1', lifecycleStatus: 'onboarding' }]);

      await service.rellenar();

      expect(expedientes.abrir).toHaveBeenCalledWith(expect.objectContaining({ sessionId: null, subjectType: 'customer' }));
      expect(materializador.asegurarNodoDeContactos).toHaveBeenCalled();
    });

    it('NO escribe manifiesto: fabricar la foto del envío ahora sería inventar evidencia con fecha falsa', async () => {
      conClientes([{ customerId: 'c1', tenantId: 't1', customerCode: null, lifecycleStatus: 'onboarding' }]);

      await service.rellenar();

      expect(materializador.escribirManifiesto).not.toHaveBeenCalled();
    });

    it('un cliente que ya pasó del alta queda con el expediente CERRADO, no abierto', async () => {
      conClientes([{ customerId: 'c1', tenantId: 't1', customerCode: null, lifecycleStatus: 'active' }]);

      await service.rellenar();

      expect(repository.actualizarExpediente).toHaveBeenCalledWith('t1', 'exp-1', { estado: 'cerrado' });
    });

    it('un cliente todavía en el alta se queda abierto', async () => {
      for (const estado of ['draft', 'pending_documents', 'onboarding', null]) {
        repository.actualizarExpediente.mockClear();
        conClientes([{ customerId: 'c1', tenantId: 't1', customerCode: null, lifecycleStatus: estado }]);

        await service.rellenar();

        expect(repository.actualizarExpediente).not.toHaveBeenCalled();
      }
    });

    it('cada evidencia cae en su carpeta con la extensión de su tipo real', async () => {
      conClientes(
        [{ customerId: 'c1', tenantId: 't1', customerCode: null, lifecycleStatus: 'onboarding' }],
        [
          {
            id: 'e1',
            documentType: 'bank_statement',
            s3Key: 'k/a.pdf',
            s3Bucket: 'atlas',
            sha256: 'h',
            mimeType: 'application/pdf',
            sizeBytes: '10',
          },
        ],
      );

      const resultado = await service.rellenar();

      expect(nodos.registrarArchivo).toHaveBeenCalledWith(expect.objectContaining({ carpeta: 'extractos', nombre: 'extracto.pdf' }));
      expect(resultado.nodos).toBe(1);
    });

    it('una evidencia sin clave de almacén no produce nodo: no hay nada que enseñar', async () => {
      conClientes(
        [{ customerId: 'c1', tenantId: 't1', customerCode: null, lifecycleStatus: 'onboarding' }],
        [{ id: 'e1', documentType: 'selfie', s3Key: null, s3Bucket: null, sha256: null, mimeType: null, sizeBytes: null }],
      );

      const resultado = await service.rellenar();

      expect(nodos.registrarArchivo).not.toHaveBeenCalled();
      expect(resultado.nodos).toBe(0);
    });

    it('un objeto que ya no está se marca AUSENTE y se cuenta: la pantalla dirá «se perdió», no fallará', async () => {
      conClientes(
        [{ customerId: 'c1', tenantId: 't1', customerCode: null, lifecycleStatus: 'onboarding' }],
        [{ id: 'e1', documentType: 'selfie', s3Key: 'k/a.jpg', s3Bucket: 'atlas', sha256: null, mimeType: 'image/jpeg', sizeBytes: '10' }],
      );
      storage.headObject.mockResolvedValueOnce(null as never);

      const resultado = await service.rellenar();

      expect(repository.actualizarNodo).toHaveBeenCalledWith('t1', 'n1', { objetoAusente: true });
      expect(resultado.sinObjeto).toBe(1);
    });

    it('una fila antigua sin bucket lo recupera del almacén en vez de quedarse sin él', async () => {
      conClientes(
        [{ customerId: 'c1', tenantId: 't1', customerCode: null, lifecycleStatus: 'onboarding' }],
        [{ id: 'e1', documentType: 'selfie', s3Key: 'k/a.jpg', s3Bucket: null, sha256: null, mimeType: 'image/jpeg', sizeBytes: '10' }],
      );

      await service.rellenar();

      expect(repository.actualizarNodo).toHaveBeenCalledWith('t1', 'n1', { storageBucket: 'atlas' });
    });

    it('un almacén que no contesta no aborta el relleno: el nodo queda registrado igual', async () => {
      conClientes(
        [{ customerId: 'c1', tenantId: 't1', customerCode: null, lifecycleStatus: 'onboarding' }],
        [{ id: 'e1', documentType: 'selfie', s3Key: 'k/a.jpg', s3Bucket: 'atlas', sha256: null, mimeType: 'image/jpeg', sizeBytes: '10' }],
      );
      storage.headObject.mockRejectedValueOnce(new Error('MinIO caído') as never);

      const resultado = await service.rellenar();

      expect(resultado).toEqual({ clientes: 1, nodos: 1, sinObjeto: 0 });
    });

    it('un archivo cuya clave ya figuraba no se cuenta dos veces', async () => {
      conClientes(
        [{ customerId: 'c1', tenantId: 't1', customerCode: null, lifecycleStatus: 'onboarding' }],
        [{ id: 'e1', documentType: 'selfie', s3Key: 'k/a.jpg', s3Bucket: 'atlas', sha256: null, mimeType: 'image/jpeg', sizeBytes: '10' }],
      );
      nodos.registrarArchivo.mockResolvedValueOnce(null as never);

      const resultado = await service.rellenar();

      expect(resultado.nodos).toBe(0);
      expect(storage.headObject).not.toHaveBeenCalled();
    });
  });

  describe('limpieza', () => {
    it('con el módulo apagado no borra nada', async () => {
      (env as { EXPEDIENTES_ENABLED: boolean }).EXPEDIENTES_ENABLED = false;

      await expect(service.limpiar()).resolves.toEqual({ ticketsCaducados: 0, nodosPurgados: 0, expedientesPurgados: 0 });
      expect(accesos.findTicketsVencidos).not.toHaveBeenCalled();
    });

    it('un ticket vencido se lleva su objeto huérfano y luego la fila', async () => {
      accesos.findTicketsVencidos.mockResolvedValueOnce([{ id: 'tk-1', storageKey: 'k/huerfano.jpg' }] as never);

      const resultado = await service.limpiar();

      expect(storage.deleteObject).toHaveBeenCalledWith('k/huerfano.jpg');
      expect(accesos.borrarTicket).toHaveBeenCalledWith('tk-1');
      expect(resultado.ticketsCaducados).toBe(1);
    });

    it('si el objeto del ticket ya no estaba, la fila se borra igual', async () => {
      accesos.findTicketsVencidos.mockResolvedValueOnce([{ id: 'tk-1', storageKey: 'k/a.jpg' }] as never);
      storage.deleteObject.mockRejectedValueOnce(new Error('no existe') as never);

      await expect(service.limpiar()).resolves.toMatchObject({ ticketsCaducados: 1 });
      expect(accesos.borrarTicket).toHaveBeenCalledWith('tk-1');
    });

    it('la papelera se mide con el plazo del entorno', async () => {
      await service.limpiar();

      expect(repository.findPapeleraVencida).toHaveBeenCalledWith(env.EXPEDIENTES_TRASH_RETENTION_DAYS, 200);
    });

    it('ANTE LA DUDA no borra: el nodo se queda y se reintenta en la vuelta siguiente', async () => {
      repository.findPapeleraVencida.mockResolvedValueOnce([nodoPapelera()] as never);
      refCounter.puedeBorrarse.mockReturnValueOnce(false);

      const resultado = await service.limpiar();

      expect(storage.deleteObject).not.toHaveBeenCalled();
      expect(repository.borrarNodoDefinitivo).not.toHaveBeenCalled();
      expect(resultado.nodosPurgados).toBe(0);
    });

    it('un nodo VIRTUAL no tiene objeto que borrar y no se consulta el conteo', async () => {
      repository.findPapeleraVencida.mockResolvedValueOnce([nodoPapelera({ virtual: true })] as never);

      const resultado = await service.limpiar();

      expect(refCounter.contar).not.toHaveBeenCalled();
      expect(storage.deleteObject).not.toHaveBeenCalled();
      expect(repository.borrarNodoDefinitivo).toHaveBeenCalledWith('t1', 'n1');
      expect(resultado.nodosPurgados).toBe(1);
    });

    it('un nodo sin clave se borra sin tocar el almacén', async () => {
      repository.findPapeleraVencida.mockResolvedValueOnce([nodoPapelera({ storageKey: null })] as never);

      await expect(service.limpiar()).resolves.toMatchObject({ nodosPurgados: 1 });
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });

    it('el conteo excluye al propio nodo, igual que en la purga manual', async () => {
      repository.findPapeleraVencida.mockResolvedValueOnce([nodoPapelera({ id: 'n-42' })] as never);

      await service.limpiar();

      expect(refCounter.contar).toHaveBeenCalledWith('k/a.jpg', 'n-42');
    });

    it('un expediente con la retención vencida se purga entero, no sólo su papelera', async () => {
      repository.findExpedientesVencidos.mockResolvedValueOnce([{ id: 'exp-9', tenantId: 't1' }] as never);

      const resultado = await service.limpiar();

      expect(expedientes.purgar).toHaveBeenCalledWith(
        expect.objectContaining({ expedienteId: 'exp-9', motivo: 'retencion_vencida', soloPapelera: false }),
      );
      expect(resultado.expedientesPurgados).toBe(1);
    });
  });
});
