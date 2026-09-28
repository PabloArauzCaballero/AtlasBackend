import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { EngineCallbackKeyGuard } from '../../../src/common/guards/engine-callback-key.guard.js';
import { BankStatementReviewCallbackController } from '../../../src/modules/credit/bank-statement-review-callback.controller.js';
import { env } from '../../../src/config/env.js';

type Mutable = { ENGINE_CALLBACK_API_KEY?: string };

/**
 * A6 · La vuelta de la revisión humana de extractos, por el lado HTTP.
 *
 * Es una ruta sin sesión: la protege la credencial del Motor, ahora como GUARD declarado en la clase
 * (así la leen los gates que miran el código, y no sólo quien abre el handler). El cuerpo sólo
 * aporta la referencia: lo que se aplica sale de releer la ejecución en el Motor.
 */
describe('POST /internal/credit/bank-statement-review-callback', () => {
  const original = env.ENGINE_CALLBACK_API_KEY;
  afterEach(() => {
    (env as Mutable).ENGINE_CALLBACK_API_KEY = original;
  });

  function contexto(cabeceras: Record<string, string | string[] | undefined>): ExecutionContext {
    return { switchToHttp: () => ({ getRequest: () => ({ headers: cabeceras }) }) } as unknown as ExecutionContext;
  }

  describe('EngineCallbackKeyGuard', () => {
    const guard = new EngineCallbackKeyGuard();

    it('el controlador lo monta a nivel de clase', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, BankStatementReviewCallbackController) as unknown[];
      expect(guards).toContain(EngineCallbackKeyGuard);
    });

    it('sin clave CONFIGURADA no pasa nadie, ni con cabecera', () => {
      (env as Mutable).ENGINE_CALLBACK_API_KEY = undefined;
      expect(() => guard.canActivate(contexto({ 'x-engine-callback-key': 'la-que-sea' }))).toThrow(UnauthorizedException);
    });

    it('con clave configurada, sin cabecera o con otra se rechaza', () => {
      (env as Mutable).ENGINE_CALLBACK_API_KEY = 'clave';
      expect(() => guard.canActivate(contexto({}))).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(contexto({ 'x-engine-callback-key': 'otra' }))).toThrow(UnauthorizedException);
    });

    it('con la clave correcta deja pasar, también si la cabecera llega repetida', () => {
      (env as Mutable).ENGINE_CALLBACK_API_KEY = 'clave';
      expect(guard.canActivate(contexto({ 'x-engine-callback-key': 'clave' }))).toBe(true);
      expect(guard.canActivate(contexto({ 'x-engine-callback-key': ['clave', 'otra'] }))).toBe(true);
    });
  });

  describe('controlador', () => {
    const sincronizar = jest.fn(async (..._args: unknown[]) => ({ applied: true, outcome: 'applied' }));
    const controlador = new BankStatementReviewCallbackController({ syncByEngineRequest: sincronizar } as never);

    it('relee la ejecución del aviso, con la persona sólo si es un id de esta base', async () => {
      await controlador.aplicar('1', { requestId: ' bs-1 ', resolvedByInternalUserId: 'ana' });
      expect(sincronizar).toHaveBeenLastCalledWith({ tenantId: '1', requestId: 'bs-1', resolvedByInternalUserId: null });

      await controlador.aplicar('1', { requestId: 'bs-1', resolvedByInternalUserId: '7' });
      expect(sincronizar).toHaveBeenLastCalledWith({ tenantId: '1', requestId: 'bs-1', resolvedByInternalUserId: '7' });
    });

    it('sin requestId es 400 y no pregunta a nadie', async () => {
      sincronizar.mockClear();
      await expect(controlador.aplicar('1', {})).rejects.toThrow(/requestId/);
      await expect(controlador.aplicar('1', { requestId: '   ' })).rejects.toThrow(/requestId/);
      expect(sincronizar).not.toHaveBeenCalled();
    });
  });
});
