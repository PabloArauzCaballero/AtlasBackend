/**
 * @file Verifica el revelado de contactos del expediente por POST, con el motivo en el cuerpo (ADM-10).
 * @business El motivo de revelar datos de terceros no puede viajar en la URL: acababa en los registros de acceso.
 * @system Ejercita `ExpedientesContactosController` con dobles del servicio y lee sus metadatos de Nest y OpenAPI.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ExpedientesContactosController } from '../../../src/modules/expedientes/expedientes-contactos.controller.js';
import { NIVEL_KEY } from '../../../src/modules/expedientes/guards/expediente-acceso.guard.js';
import { revelarContactosBodySchema } from '../../../src/modules/expedientes/expedientes.schemas.js';
import type { ActorExpediente } from '../../../src/modules/expedientes/expedientes.types.js';

const ACTOR: ActorExpediente = { tipo: 'internal_user', id: '7', roles: [], permisos: ['expedientes.pii.revelar'] };

function montar() {
  const contactos = { componer: jest.fn(async (..._a: unknown[]) => ({ enmascarado: false })) };
  const expedientes = { obtener: jest.fn(async (..._a: unknown[]) => ({ subjectId: '9' })) };
  const controller = new ExpedientesContactosController(contactos as never, expedientes as never);
  return { controller, contactos };
}

const peticion = { expediente: { actor: ACTOR, nivel: 'leer' } } as never;

describe('ExpedientesContactosController', () => {
  it('POST revelar: compone con revelar=true y el motivo DEL CUERPO, para el cliente del expediente', async () => {
    const { controller, contactos } = montar();
    const r = await controller.revelarContactos('1', { id: '44' }, { motivo: 'Llamada de cobranza autorizada' }, peticion);
    expect(r).toEqual({ enmascarado: false });
    expect(contactos.componer).toHaveBeenCalledWith({
      tenantId: '1',
      expedienteId: '44',
      customerId: '9',
      actor: ACTOR,
      revelar: true,
      motivo: 'Llamada de cobranza autorizada',
    });
  });

  it('el GET sigue revelando por compatibilidad (mismo servicio, mismas comprobaciones)', async () => {
    const { controller, contactos } = montar();
    await controller.obtenerContactos('1', { id: '44' }, { revelar: true, motivo: 'motivo largo' }, peticion);
    expect(contactos.componer).toHaveBeenCalledWith(expect.objectContaining({ revelar: true, motivo: 'motivo largo' }));
  });

  it('POST revelar: misma ruta base, mismo nivel exigido y sin caché', () => {
    const handler = ExpedientesContactosController.prototype.revelarContactos;
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('revelar');
    expect(Reflect.getMetadata(NIVEL_KEY, handler)).toBe('leer');
    expect(Reflect.getMetadata(NIVEL_KEY, ExpedientesContactosController.prototype.obtenerContactos)).toBe('leer');
    expect(Reflect.getMetadata('__headers__', handler)).toEqual([{ name: 'Cache-Control', value: 'private, no-store' }]);
  });

  it('OpenAPI: `revelar` y `motivo` del GET salen como obsoletos', () => {
    const params = Reflect.getMetadata('swagger/apiParameters', ExpedientesContactosController.prototype.obtenerContactos) as {
      name: string;
      deprecated?: boolean;
    }[];
    expect(
      params
        .filter((p) => p.deprecated)
        .map((p) => p.name)
        .sort(),
    ).toEqual(['motivo', 'revelar']);
  });

  it('el cuerpo admite sólo `motivo`: nada de colar `revelar` u otros campos', () => {
    expect(revelarContactosBodySchema.safeParse({ motivo: 'Llamada de cobranza' }).success).toBe(true);
    expect(revelarContactosBodySchema.safeParse({ motivo: 'x', revelar: false }).success).toBe(false);
    expect(revelarContactosBodySchema.safeParse({}).success).toBe(false);
    expect(revelarContactosBodySchema.safeParse({ motivo: 'x'.repeat(501) }).success).toBe(false);
  });
});
