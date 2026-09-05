import { beforeEach, describe, expect, it } from '@jest/globals';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ConcesionService } from '../../../src/modules/expedientes/application/concesion.service.js';
import type { ExpedientesRepository } from '../../../src/modules/expedientes/repositories/expedientes.repository.js';
import type { ActorExpediente, Nivel } from '../../../src/modules/expedientes/expedientes.types.js';

/**
 * Quién puede ver la carpeta de una persona.
 *
 * Es la prueba más importante del módulo: la autorización por carpeta es lo que `@Roles(...)` no
 * sabe expresar, y un fallo aquí no se ve en pantalla — se ve cuando alguien abre el expediente de
 * un cliente que no le corresponde y nadie se entera. Lo que se fija es que el nivel efectivo sea
 * el MAYOR de las tres fuentes, que la herencia baje pero no suba de vuelta, y que los dos techos
 * —congelado y purgado— no los levante ningún permiso.
 */
type Concesion = {
  id: string;
  nodoId: string;
  principalTipo: string;
  principalId: string;
  nivel: string;
  motivo: string | null;
  venceEn: Date | null;
  revocadoEn: Date | null;
  createdAtValue: Date;
};

function actor(overrides: Partial<ActorExpediente> = {}): ActorExpediente {
  return { tipo: 'internal_user', id: '7', roles: ['RISK_ANALYST'], permisos: [], ...overrides };
}

function concesion(overrides: Partial<Concesion> = {}): Concesion {
  return {
    id: '1',
    nodoId: '100',
    principalTipo: 'rol',
    principalId: 'RISK_ANALYST',
    nivel: 'leer',
    motivo: 'investigación abierta',
    venceEn: null,
    revocadoEn: null,
    createdAtValue: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ConcesionService', () => {
  let concesiones: Concesion[];
  let ancestros: Array<{ id: string; ruta: string }>;
  let registradas: Array<Record<string, unknown>>;
  let service: ConcesionService;

  beforeEach(() => {
    concesiones = [];
    ancestros = [];
    registradas = [];
    const repository = {
      findAncestros: async () => ancestros,
      findConcesionesVigentes: async (_tenant: string, nodoIds: readonly string[]) =>
        concesiones.filter((item) => nodoIds.includes(item.nodoId) && !item.revocadoEn),
      findConcesion: async (_tenant: string, id: string) => concesiones.find((item) => item.id === id) ?? null,
      crearConcesion: async (values: Record<string, unknown>) => ({ ...concesion(), ...values, id: '99' }),
      revocarConcesion: async (_tenant: string, id: string) => {
        const item = concesiones.find((candidato) => candidato.id === id);
        if (item) item.revocadoEn = new Date();
      },
      registrar: async (values: Record<string, unknown>) => {
        registradas.push(values);
      },
    } as unknown as ExpedientesRepository;
    // El mismo doble sirve de repositorio y de repositorio de accesos: la separación es de tamaño
    // de archivo, no de contrato, y duplicar el doble sólo obligaría a mantenerlo dos veces.
    service = new ConcesionService(repository, repository as never);
  });

  const resolver = (input: Partial<Parameters<ConcesionService['resolver']>[0]> = {}): Promise<Nivel | null> =>
    service.resolver({ tenantId: '1', expedienteId: '10', actor: actor(), ruta: '', ...input });

  describe('nivel base por permiso', () => {
    it('sin permisos de expedientes no se ve nada', async () => {
      await expect(resolver()).resolves.toBeNull();
    });

    it('toma el mayor de los permisos que tenga', async () => {
      const conPermisos = actor({ permisos: ['expedientes.leer', 'expedientes.escribir'] });
      await expect(resolver({ actor: conPermisos })).resolves.toBe('escribir');
    });
  });

  describe('concesiones', () => {
    it('una concesión a su ROL sube el nivel por encima del suelo', async () => {
      concesiones = [concesion({ nodoId: '100', nivel: 'escribir', principalId: 'RISK_ANALYST' })];
      const conLeer = actor({ permisos: ['expedientes.leer'] });
      await expect(resolver({ actor: conLeer, nodoId: '100' })).resolves.toBe('escribir');
    });

    it('una concesión a OTRO rol no le afecta', async () => {
      concesiones = [concesion({ nodoId: '100', nivel: 'administrar', principalId: 'COLLECTIONS_AGENT' })];
      const conLeer = actor({ permisos: ['expedientes.leer'] });
      await expect(resolver({ actor: conLeer, nodoId: '100' })).resolves.toBe('leer');
    });

    it('se HEREDA desde el ancestro hacia el nodo', async () => {
      // La concesión está en la raíz del expediente y el nodo es un archivo hondo: sin herencia,
      // compartir una carpeta obligaría a repetir la concesión archivo por archivo.
      ancestros = [{ id: '1', ruta: '' }, { id: '2', ruta: '/auth' }];
      concesiones = [concesion({ nodoId: '2', nivel: 'compartir' })];
      const sinPermisos = actor();
      await expect(resolver({ actor: sinPermisos, nodoId: '100', ruta: '/auth/anverso.jpg' })).resolves.toBe('compartir');
    });

    it('una concesión más baja en un hijo NO baja lo que dio el padre', async () => {
      // El nivel efectivo es el MAYOR, nunca el más cercano: si una concesión pudiera restar, el
      // acceso dependería del orden en que la base devuelve las filas.
      ancestros = [{ id: '1', ruta: '' }];
      concesiones = [
        concesion({ id: '1', nodoId: '1', nivel: 'escribir' }),
        concesion({ id: '2', nodoId: '100', nivel: 'leer' }),
      ];
      await expect(resolver({ actor: actor(), nodoId: '100', ruta: '/otros/x.pdf' })).resolves.toBe('escribir');
    });

    it('una concesión REVOCADA deja de contar', async () => {
      concesiones = [concesion({ nodoId: '100', nivel: 'administrar', revocadoEn: new Date() })];
      await expect(resolver({ actor: actor(), nodoId: '100' })).resolves.toBeNull();
    });
  });

  describe('los dos techos', () => {
    it('un nodo congelado no admite escritura por mucho permiso que se tenga', async () => {
      const admin = actor({ permisos: ['expedientes.administrar'] });
      await expect(resolver({ actor: admin, nodoId: '100', congelado: true })).resolves.toBe('leer');
    });

    it('un expediente purgado sólo admite leer', async () => {
      const admin = actor({ permisos: ['expedientes.administrar'] });
      await expect(resolver({ actor: admin, expedientePurgado: true })).resolves.toBe('leer');
    });
  });

  describe('conceder', () => {
    const base = {
      tenantId: '1',
      expedienteId: '10',
      nodoId: '100',
      actor: actor({ permisos: ['expedientes.compartir'] }),
      principalTipo: 'rol' as const,
      principalId: 'FRAUD_ANALYST',
      motivo: 'investigación de fraude abierta',
      venceEn: null,
    };

    it('no se puede dar más nivel del que se tiene', async () => {
      await expect(
        service.conceder({ ...base, nivelDelActor: 'compartir', nivel: 'administrar' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('exige un motivo con contenido', async () => {
      await expect(service.conceder({ ...base, nivelDelActor: 'compartir', nivel: 'leer', motivo: 'ok' })).rejects.toThrow();
    });

    it('deja el motivo en la bitácora', async () => {
      await service.conceder({ ...base, nivelDelActor: 'compartir', nivel: 'leer' });
      expect(registradas).toHaveLength(1);
      expect(registradas[0]).toMatchObject({ accion: 'compartir', detalle: expect.objectContaining({ motivo: base.motivo }) });
    });
  });

  describe('revocar', () => {
    it('nadie se quita a sí mismo su última administración', async () => {
      // Sin esta guarda el expediente puede quedar sin nadie que pueda purgarlo ni volver a
      // conceder acceso, y recuperarlo exige tocar la base a mano.
      concesiones = [concesion({ id: '5', nodoId: '100', principalTipo: 'usuario_interno', principalId: '7', nivel: 'administrar' })];
      await expect(
        service.revocar({
          tenantId: '1',
          expedienteId: '10',
          nodoId: '100',
          concesionId: '5',
          actor: actor({ permisos: ['expedientes.administrar'] }),
          nivelDelActor: 'administrar',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
