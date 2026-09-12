import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ExpedienteService } from '../../../src/modules/expedientes/application/expediente.service.js';
import { env } from '../../../src/config/env.js';
import type { ExpedientesRepository } from '../../../src/modules/expedientes/repositories/expedientes.repository.js';
import type { NodoService } from '../../../src/modules/expedientes/application/nodo.service.js';
import type { DocumentStorageService } from '../../../src/common/storage/document-storage.service.js';
import type { ObjectRefCounterService } from '../../../src/modules/expedientes/application/object-ref-counter.service.js';
import type { ActorExpediente } from '../../../src/modules/expedientes/expedientes.types.js';
import type { ExpedienteModel } from '../../../src/database/models/index.js';

/**
 * El ciclo de vida del expediente.
 *
 * Lo que se fija aquí son las tres reglas que no dan la cara cuando se rompen: que abrir dos veces
 * no deje al cliente con dos carpetas medio llenas, que el expediente de otro tenant conteste 404 y
 * no 403 —un 403 confirmaría que existe—, y que la purga no borre un objeto que otra fila sigue
 * referenciando. Ninguna de las tres lanza un error en producción si se rompe: la primera duplica,
 * la segunda filtra, y la tercera deja un extracto bancario sin bytes detrás.
 */
type Nodo = {
  id: string;
  ruta: string;
  inmutable: boolean;
  borradoEn: Date | null;
  storageKey: string | null;
};

const actor: ActorExpediente = { tipo: 'internal_user', id: '7', roles: [], permisos: [] };

function nodo(overrides: Partial<Nodo> = {}): Nodo {
  return { id: 'n1', ruta: '/auth/carnet.jpg', inmutable: false, borradoEn: null, storageKey: null, ...overrides };
}

function expediente(overrides: Partial<ExpedienteModel> = {}): ExpedienteModel {
  return { id: 'exp-1', purgadoEn: null, ...overrides } as ExpedienteModel;
}

type Dobles = {
  repository: jest.Mocked<
    Pick<
      ExpedientesRepository,
      | 'findExpediente'
      | 'findExpedientePorSujeto'
      | 'crearExpediente'
      | 'registrar'
      | 'listarExpedientes'
      | 'listarTodosLosNodos'
      | 'actualizarNodo'
      | 'actualizarExpediente'
      | 'borrarNodoDefinitivo'
    >
  >;
  nodos: { asegurarCarpeta: jest.Mock };
  storage: { deleteObject: jest.Mock };
  refCounter: { contar: jest.Mock; puedeBorrarse: jest.Mock };
};

function construir(): { service: ExpedienteService } & Dobles {
  const repository = {
    findExpediente: jest.fn(async () => null),
    findExpedientePorSujeto: jest.fn(async () => null),
    crearExpediente: jest.fn(async () => expediente()),
    registrar: jest.fn(async () => undefined),
    listarExpedientes: jest.fn(async () => ({ filas: [], total: 0 })),
    listarTodosLosNodos: jest.fn(async () => [] as Nodo[]),
    actualizarNodo: jest.fn(async () => undefined),
    actualizarExpediente: jest.fn(async () => undefined),
    borrarNodoDefinitivo: jest.fn(async () => undefined),
  } as unknown as Dobles['repository'];
  const nodos = { asegurarCarpeta: jest.fn(async () => ({ id: 'c' })) } as unknown as Dobles['nodos'];
  const storage = { deleteObject: jest.fn(async () => undefined) } as unknown as Dobles['storage'];
  const refCounter = {
    contar: jest.fn(async () => ({ nodos: 0, evidencia: 0, extractos: 0, motor: 0 })),
    puedeBorrarse: jest.fn(() => true),
  } as unknown as Dobles['refCounter'];

  const service = new ExpedienteService(
    repository as unknown as ExpedientesRepository,
    nodos as unknown as NodoService,
    storage as unknown as DocumentStorageService,
    refCounter as unknown as ObjectRefCounterService,
  );
  return { service, repository, nodos, storage, refCounter };
}

describe('ExpedienteService', () => {
  let original: boolean;

  beforeEach(() => {
    original = env.EXPEDIENTES_ENABLED;
    (env as { EXPEDIENTES_ENABLED: boolean }).EXPEDIENTES_ENABLED = true;
  });

  afterEach(() => {
    (env as { EXPEDIENTES_ENABLED: boolean }).EXPEDIENTES_ENABLED = original;
  });

  describe('abrir', () => {
    it('es idempotente por sujeto y sesión: el segundo disparo devuelve el mismo expediente sin crear carpetas', async () => {
      const { service, repository, nodos } = construir();
      const yaExiste = expediente({ id: 'exp-viejo' } as Partial<ExpedienteModel>);
      repository.findExpedientePorSujeto.mockResolvedValueOnce(yaExiste);

      const resultado = await service.abrir({
        tenantId: 't1',
        subjectType: 'customer',
        subjectId: 'c1',
        sessionId: 's1',
        customerCode: null,
        actor,
      });

      expect(resultado).toBe(yaExiste);
      expect(repository.crearExpediente).not.toHaveBeenCalled();
      expect(nodos.asegurarCarpeta).not.toHaveBeenCalled();
      expect(repository.registrar).not.toHaveBeenCalled();
    });

    it('crea las cuatro carpetas base vacías, antes de que exista un solo archivo', async () => {
      const { service, nodos } = construir();

      await service.abrir({
        tenantId: 't1',
        subjectType: 'customer',
        subjectId: 'c1',
        sessionId: 's1',
        customerCode: 'CLI-1',
        actor,
      });

      const rutas = nodos.asegurarCarpeta.mock.calls.map((llamada) => (llamada[0] as { ruta: string }).ruta);
      expect(rutas).toEqual(['/auth', '/extractos', '/domicilio', '/otros']);
    });

    it('deja rastro de la creación con el sujeto y la sesión', async () => {
      const { service, repository } = construir();

      await service.abrir({
        tenantId: 't1',
        subjectType: 'partner',
        subjectId: 'p9',
        sessionId: null,
        customerCode: null,
        actor,
      });

      expect(repository.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          accion: 'crear',
          actorTipo: 'internal_user',
          detalle: { subjectType: 'partner', subjectId: 'p9', sessionId: null },
        }),
      );
    });

    it('abre aunque el módulo esté apagado: el gancho del onboarding no debe fallar por la bandera', async () => {
      (env as { EXPEDIENTES_ENABLED: boolean }).EXPEDIENTES_ENABLED = false;
      const { service, repository } = construir();

      await expect(
        service.abrir({ tenantId: 't1', subjectType: 'customer', subjectId: 'c1', sessionId: null, customerCode: null, actor }),
      ).resolves.toBeDefined();
      expect(repository.crearExpediente).toHaveBeenCalled();
    });
  });

  describe('lectura', () => {
    it('contesta 404 —y no 403— cuando el expediente es de otro tenant', async () => {
      const { service, repository } = construir();
      repository.findExpediente.mockResolvedValueOnce(null);

      await expect(service.obtener('t1', 'exp-de-otro')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('con el módulo apagado, obtener/listar/porSujeto contestan 503 y no tocan el repositorio', async () => {
      (env as { EXPEDIENTES_ENABLED: boolean }).EXPEDIENTES_ENABLED = false;
      const { service, repository } = construir();

      await expect(service.obtener('t1', 'exp-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(service.porSujeto('t1', 'customer', 'c1')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(() => service.listar({ tenantId: 't1', offset: 0, limit: 10 })).toThrow(ServiceUnavailableException);
      expect(repository.findExpediente).not.toHaveBeenCalled();
      expect(repository.listarExpedientes).not.toHaveBeenCalled();
    });
  });

  describe('congelar', () => {
    it('congela lo mutable, se salta `/otros` y no vuelve a tocar lo ya inmutable', async () => {
      const { service, repository } = construir();
      repository.listarTodosLosNodos.mockResolvedValueOnce([
        nodo({ id: 'a', ruta: '/auth/carnet.jpg' }),
        nodo({ id: 'b', ruta: '/otros' }),
        nodo({ id: 'c', ruta: '/extractos/enero.pdf', inmutable: true }),
        nodo({ id: 'd', ruta: '/otros/extra.pdf' }),
      ] as never);

      const congelados = await service.congelar({ tenantId: 't1', expedienteId: 'exp-1', actor });

      expect(congelados).toBe(2);
      const tocados = repository.actualizarNodo.mock.calls.map((llamada) => llamada[1]);
      expect(tocados).toEqual(['a', 'd']);
    });

    it('marca el expediente como enviado y lo registra con el conteo', async () => {
      const { service, repository } = construir();
      repository.listarTodosLosNodos.mockResolvedValueOnce([nodo({ id: 'a' })] as never);

      await service.congelar({ tenantId: 't1', expedienteId: 'exp-1', actor });

      expect(repository.actualizarExpediente).toHaveBeenCalledWith('t1', 'exp-1', expect.objectContaining({ estado: 'enviado' }));
      expect(repository.registrar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'congelar', detalle: { nodosCongelados: 1 } }));
    });
  });

  describe('purgar', () => {
    it('borra el objeto sólo cuando el conteo dice que nadie más lo referencia', async () => {
      const { service, repository, storage, refCounter } = construir();
      repository.listarTodosLosNodos.mockResolvedValueOnce([
        nodo({ id: 'a', storageKey: 'k/solo.jpg' }),
        nodo({ id: 'b', ruta: '/extractos/enero.pdf', storageKey: 'k/compartido.pdf' }),
      ] as never);
      refCounter.puedeBorrarse.mockReturnValueOnce(true).mockReturnValueOnce(false);

      const resultado = await service.purgar({ tenantId: 't1', expedienteId: 'exp-1', actor, motivo: 'gdpr', soloPapelera: false });

      expect(storage.deleteObject).toHaveBeenCalledTimes(1);
      expect(storage.deleteObject).toHaveBeenCalledWith('k/solo.jpg');
      expect(resultado).toEqual({ nodos: 2, objetosBorrados: 1, objetosConservados: 1 });
      expect(repository.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ detalle: expect.objectContaining({ objetoConservadoPor: ['/extractos/enero.pdf'] }) }),
      );
    });

    it('excluye del conteo al propio nodo: si no, cada archivo se referenciaría a sí mismo y nunca se borraría', async () => {
      const { service, repository, refCounter } = construir();
      repository.listarTodosLosNodos.mockResolvedValueOnce([nodo({ id: 'n-42', storageKey: 'k/a.jpg' })] as never);

      await service.purgar({ tenantId: 't1', expedienteId: 'exp-1', actor, motivo: 'gdpr', soloPapelera: false });

      expect(refCounter.contar).toHaveBeenCalledWith('k/a.jpg', 'n-42');
    });

    it('un fallo del almacén cuenta como conservado y no aborta la purga de las filas', async () => {
      const { service, repository, storage } = construir();
      repository.listarTodosLosNodos.mockResolvedValueOnce([
        nodo({ id: 'a', storageKey: 'k/a.jpg' }),
        nodo({ id: 'b', storageKey: 'k/b.jpg' }),
      ] as never);
      storage.deleteObject.mockRejectedValueOnce(new Error('MinIO caído') as never);

      const resultado = await service.purgar({ tenantId: 't1', expedienteId: 'exp-1', actor, motivo: 'gdpr', soloPapelera: false });

      expect(resultado).toEqual({ nodos: 2, objetosBorrados: 1, objetosConservados: 1 });
      expect(repository.borrarNodoDefinitivo).toHaveBeenCalledTimes(2);
    });

    it('vaciar la papelera se limita a los nodos borrados y no marca el expediente como purgado', async () => {
      const { service, repository } = construir();
      repository.listarTodosLosNodos.mockResolvedValueOnce([
        nodo({ id: 'vivo', borradoEn: null }),
        nodo({ id: 'papelera', borradoEn: new Date('2026-01-01') }),
      ] as never);

      const resultado = await service.purgar({ tenantId: 't1', expedienteId: 'exp-1', actor, motivo: 'limpieza', soloPapelera: true });

      expect(resultado.nodos).toBe(1);
      expect(repository.borrarNodoDefinitivo).toHaveBeenCalledWith('t1', 'papelera');
      expect(repository.actualizarExpediente).not.toHaveBeenCalled();
    });

    it('la purga completa incluye los nodos ya borrados y cierra el expediente', async () => {
      const { service, repository } = construir();
      repository.listarTodosLosNodos.mockResolvedValueOnce([
        nodo({ id: 'vivo' }),
        nodo({ id: 'papelera', borradoEn: new Date('2026-01-01') }),
      ] as never);

      await service.purgar({ tenantId: 't1', expedienteId: 'exp-1', actor, motivo: 'gdpr', soloPapelera: false });

      expect(repository.listarTodosLosNodos).toHaveBeenCalledWith('t1', 'exp-1', true);
      expect(repository.borrarNodoDefinitivo).toHaveBeenCalledTimes(2);
      expect(repository.actualizarExpediente).toHaveBeenCalledWith('t1', 'exp-1', expect.objectContaining({ estado: 'purgado' }));
    });
  });

  describe('purgarPorSujeto', () => {
    it('purga todos los expedientes del sujeto —uno por sesión— y suma los objetos borrados', async () => {
      const { service, repository, refCounter } = construir();
      repository.findExpedientePorSujeto
        .mockResolvedValueOnce(expediente({ id: 'exp-1' } as Partial<ExpedienteModel>))
        .mockResolvedValueOnce(expediente({ id: 'exp-2' } as Partial<ExpedienteModel>))
        .mockResolvedValueOnce(null);
      repository.listarTodosLosNodos
        .mockResolvedValueOnce([nodo({ id: 'a', storageKey: 'k/a.jpg' })] as never)
        .mockResolvedValueOnce([nodo({ id: 'b', storageKey: 'k/b.jpg' })] as never);
      refCounter.puedeBorrarse.mockReturnValue(true);

      const resultado = await service.purgarPorSujeto({ tenantId: 't1', subjectType: 'customer', subjectId: 'c1', actor, motivo: 'gdpr' });

      expect(resultado).toEqual({ expedientes: 2, objetosBorrados: 2 });
    });

    it('para en un expediente ya purgado en vez de reprocesarlo en bucle', async () => {
      const { service, repository } = construir();
      repository.findExpedientePorSujeto.mockResolvedValue(
        expediente({ id: 'exp-1', purgadoEn: new Date('2026-01-01') } as Partial<ExpedienteModel>),
      );

      const resultado = await service.purgarPorSujeto({ tenantId: 't1', subjectType: 'customer', subjectId: 'c1', actor, motivo: 'gdpr' });

      expect(resultado).toEqual({ expedientes: 0, objetosBorrados: 0 });
      expect(repository.listarTodosLosNodos).not.toHaveBeenCalled();
    });

    it('con el módulo apagado no borra nada: la supresión la reintenta el flujo de privacidad', async () => {
      (env as { EXPEDIENTES_ENABLED: boolean }).EXPEDIENTES_ENABLED = false;
      const { service, repository } = construir();

      const resultado = await service.purgarPorSujeto({ tenantId: 't1', subjectType: 'customer', subjectId: 'c1', actor, motivo: 'gdpr' });

      expect(resultado).toEqual({ expedientes: 0, objetosBorrados: 0 });
      expect(repository.findExpedientePorSujeto).not.toHaveBeenCalled();
    });
  });
});
