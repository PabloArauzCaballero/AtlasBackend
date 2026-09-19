/**
 * @file El callback que cierra una revisión HUMANA de identidad exige su credencial de servicio.
 * @business Por esta ruta entra el veredicto de un analista que aprobó o rechazó un carnet en el
 *   Motor. Si cualquiera pudiera llamarla, cualquiera aprobaría identidades; si la credencial no
 *   está configurada, no la acepta a NADIE y el intento se queda «en revisión» para siempre: el
 *   cliente no puede pedir crédito y nada avisa de que el circuito está cortado.
 * @system Unitaria sobre el controlador —la decisión de autorizar es suya y no de un guard—, con la
 *   variable de entorno manipulada en caliente. No levanta Nest: lo que se fija es que las tres
 *   formas de fallar (sin clave configurada, sin cabecera, con cabecera equivocada) terminen en 401
 *   y que NINGUNA toque el repositorio.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { IdentityReviewCallbackController } from '../../../src/modules/customer-onboarding/identity-review-callback.controller.js';
import { env } from '../../../src/config/env.js';

type Mutable = { ENGINE_CALLBACK_API_KEY?: string };

const buscarIntento = jest.fn(async () => null);
const aplicar = jest.fn(async () => ({ applied: true }));

function controlador(): IdentityReviewCallbackController {
  return new IdentityReviewCallbackController({ aplicar } as never, { findAttemptByExecutionId: buscarIntento } as never);
}

const cuerpo = { executionId: 'exec-1', decision: 'APPROVE', resolvedByInternalUserId: '7' };

describe('callback de revisión humana de identidad', () => {
  const original = env.ENGINE_CALLBACK_API_KEY;

  beforeEach(() => {
    buscarIntento.mockClear();
    aplicar.mockClear();
    (env as Mutable).ENGINE_CALLBACK_API_KEY = original;
  });

  it('sin credencial CONFIGURADA no acepta a nadie, ni siquiera con cabecera', async () => {
    (env as Mutable).ENGINE_CALLBACK_API_KEY = undefined;
    await expect(controlador().aplicar('1', 'la-que-sea', cuerpo)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(buscarIntento).not.toHaveBeenCalled();
  });

  it('con credencial configurada, una llamada SIN cabecera se rechaza', async () => {
    (env as Mutable).ENGINE_CALLBACK_API_KEY = 'clave-del-motor';
    await expect(controlador().aplicar('1', undefined, cuerpo)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(buscarIntento).not.toHaveBeenCalled();
  });

  it('una cabecera equivocada tampoco pasa', async () => {
    (env as Mutable).ENGINE_CALLBACK_API_KEY = 'clave-del-motor';
    await expect(controlador().aplicar('1', 'otra-clave', cuerpo)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(buscarIntento).not.toHaveBeenCalled();
  });

  it('con la credencial correcta el controlador SÍ consulta el intento', async () => {
    (env as Mutable).ENGINE_CALLBACK_API_KEY = 'clave-del-motor';
    // El intento no existe, así que termina en 404 — lo que importa aquí es que pasó la autorización.
    await expect(controlador().aplicar('1', 'clave-del-motor', cuerpo)).rejects.toThrow(/ejecucion exec-1/i);
    expect(buscarIntento).toHaveBeenCalledTimes(1);
  });
});
