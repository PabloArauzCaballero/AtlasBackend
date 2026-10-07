/**
 * @file El monitor del servidor (`systems/monitor`) separa lectura y escritura por permiso de servicio.
 * @business El informador lee el resumen con `systems:monitor:read` y empuja la instantánea del host con
 *   `systems:monitor:write`. Un token que sólo lee no debe poder escribir lo que el portal enseña como
 *   «Servidor de TEST», y nadie que no sea `atlas-monitor` entra en ninguna de las dos.
 * @system Guard real con el `Reflector` real sobre los métodos del controlador: si alguien intercambia los
 *   scopes o quita el `@ServiceScope`, esta prueba lo ve; los golden de contrato sólo miran la superficie.
 */
import { describe, expect, it, jest } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../src/common/decorators/public.decorator.js';
import { ServiceTokenGuard, type RequestWithServiceActor } from '../../../src/common/guards/service-token.guard.js';
import {
  SYSTEMS_MONITOR_SCOPE,
  SYSTEMS_MONITOR_WRITE_SCOPE,
  SystemsMonitorController,
} from '../../../src/modules/systems-ops/systems-monitor.controller.js';
import { signServiceToken } from '../../../src/platform/security/service-token.js';

type Handler = 'getSummary' | 'ingestHostSnapshot';

function guardFor(handler: Handler, token: string) {
  const request: RequestWithServiceActor = { headers: { authorization: `Bearer ${token}` }, query: {} };
  const context = {
    getHandler: () => SystemsMonitorController.prototype[handler],
    getClass: () => SystemsMonitorController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { request, run: () => new ServiceTokenGuard(new Reflector()).canActivate(context) };
}

const token = (scopes: string[], service = 'atlas-monitor') =>
  signServiceToken({ service, tenantId: '9', scopes, audienceContext: 'systems' });

describe('SystemsMonitorController — permisos de servicio', () => {
  it('es @Public (el guard de sesión no evalúa el token de servicio)', () => {
    expect(new Reflector().get(IS_PUBLIC_KEY, SystemsMonitorController)).toBe(true);
  });

  it('el resumen entra con el permiso de lectura y toma el tenant del token', () => {
    const { run, request } = guardFor('getSummary', token([SYSTEMS_MONITOR_SCOPE]));
    expect(run()).toBe(true);
    expect(request.serviceActor).toMatchObject({ service: 'atlas-monitor', tenantId: '9' });
  });

  it('host-snapshot rechaza un token que sólo lee', () => {
    expect(() => guardFor('ingestHostSnapshot', token([SYSTEMS_MONITOR_SCOPE])).run()).toThrow();
  });

  it('host-snapshot entra con el permiso de escritura, y ese permiso no abre el resumen', () => {
    expect(guardFor('ingestHostSnapshot', token([SYSTEMS_MONITOR_WRITE_SCOPE])).run()).toBe(true);
    expect(() => guardFor('getSummary', token([SYSTEMS_MONITOR_WRITE_SCOPE])).run()).toThrow();
  });

  it('otro servicio con los dos permisos no entra en ninguna', () => {
    const stranger = token([SYSTEMS_MONITOR_SCOPE, SYSTEMS_MONITOR_WRITE_SCOPE], 'credit-worker');
    expect(() => guardFor('getSummary', stranger).run()).toThrow('SERVICE_NOT_ALLOWED');
    expect(() => guardFor('ingestHostSnapshot', stranger).run()).toThrow('SERVICE_NOT_ALLOWED');
  });

  it('pasa el tenant del token, no otro, a los servicios', async () => {
    const summarize = jest.fn(async (_tenantId: string) => ({ ok: true }));
    const save = jest.fn(async (_tenantId: string, _body: unknown) => undefined);
    const controller = new SystemsMonitorController({ summarize } as never, { save } as never);
    const request = { serviceActor: { tenantId: '9' } } as unknown as RequestWithServiceActor;
    await controller.getSummary(request);
    await controller.ingestHostSnapshot(request, {} as never);
    expect(summarize).toHaveBeenCalledWith('9');
    expect(save).toHaveBeenCalledWith('9', {});
  });
});
