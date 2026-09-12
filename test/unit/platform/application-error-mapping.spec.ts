/**
 * @file AT-013 — el error de aplicación se mapea al mismo HTTP de antes, y el contexto no toma
 *   identidad de cabeceras.
 * @business Migrar un caso de uso fuera de Nest no puede cambiar ni un código ni un mensaje que el
 *   cliente ya lee; y una cabecera `x-tenant-id` jamás autoriza nada.
 * @system Pruebas puras (sin Nest arrancado) más el filtro HTTP real con un host simulado.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { ArgumentsHost, HttpStatus, UnprocessableEntityException } from '@nestjs/common';
import { HttpExceptionFilter } from '../../../src/common/filters/http-exception.filter.js';
import { denialError } from '../../../src/modules/credit/application/credit-application-admission.service.js';
import { ApplicationError, HTTP_STATUS_BY_KIND, toHttpException } from '../../../src/platform/contracts/application-error.js';
import { buildRequestContext, requireTenant } from '../../../src/platform/contracts/request-context.js';

function fakeHost(): { host: ArgumentsHost; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'POST', url: '/api/v1/x', correlationId: 'c-1' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('ApplicationError → HTTP', () => {
  it('cada familia conserva el código HTTP que ya usaban las excepciones Nest', () => {
    for (const [kind, status] of Object.entries(HTTP_STATUS_BY_KIND)) {
      const error = new ApplicationError({ kind: kind as keyof typeof HTTP_STATUS_BY_KIND, code: 'X' });
      expect(toHttpException(error).getStatus()).toBe(status);
    }
  });

  it('la denegación de crédito produce EXACTAMENTE el mensaje anterior y un 422', () => {
    const error = denialError({
      eligible: false,
      blockers: [{ code: 'IDENTITY_NOT_VERIFIED' }, { code: 'FRAUD_CASE_OPEN' }],
      evaluationId: '1',
    } as never);
    expect(error.message).toBe('CUSTOMER_NOT_ELIGIBLE: IDENTITY_NOT_VERIFIED, FRAUD_CASE_OPEN');
    expect(error.details).toEqual({ blockers: ['IDENTITY_NOT_VERIFIED', 'FRAUD_CASE_OPEN'] });
    const http = toHttpException(error);
    expect(http).toBeInstanceOf(UnprocessableEntityException);
    expect(http.message).toBe('CUSTOMER_NOT_ELIGIBLE: IDENTITY_NOT_VERIFIED, FRAUD_CASE_OPEN');
  });

  it('el filtro HTTP traduce un ApplicationError lanzado desde un caso de uso al código previo', () => {
    const { host, status, json } = fakeHost();
    new HttpExceptionFilter().catch(new ApplicationError({ kind: 'conflict', code: 'CREDIT_APPLICATION_ALREADY_OPEN' }), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json.mock.calls[0][0]).toMatchObject({ error: { code: 'CONFLICT', message: 'CREDIT_APPLICATION_ALREADY_OPEN' } });
  });

  it('un error técnico desconocido sigue saliendo como 500 seguro, sin stack ni SQL', () => {
    const { host, status, json } = fakeHost();
    new HttpExceptionFilter().catch(new Error('relation "customer.customers" does not exist at line 3'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = JSON.stringify(json.mock.calls[0][0]);
    expect(body).not.toContain('customer.customers');
    expect(body).not.toContain('at line');
  });

  it('los detalles son inmutables y el error conserva la causa técnica sin exponerla en el mensaje', () => {
    const cause = new Error('driver: contraseña incorrecta');
    const error = new ApplicationError({ kind: 'unavailable', code: 'PROVIDER_DOWN', details: { provider: 'segip' }, cause });
    expect(() => {
      (error.details as { provider: string }).provider = 'otro';
    }).toThrow();
    expect(error.message).toBe('PROVIDER_DOWN');
    expect(error.cause).toBe(cause);
  });
});

describe('RequestContext', () => {
  it('toma tenant y actor SOLO del usuario autenticado; la cabecera queda como sugerencia', () => {
    const context = buildRequestContext({
      user: { sub: 's', role: 'customer', tenantId: '1', customerId: '42' },
      headers: { 'x-tenant-id': '999' },
      correlationId: 'c-1',
    });
    expect(context.tenantId).toBe('1');
    expect(context.hintedTenantId).toBe('999');
    expect(context.actor).toEqual({ type: 'customer', id: '42', internalUserId: null });
    expect(requireTenant(context)).toBe('1');
  });

  it('sin usuario, la cabecera no se convierte en identidad autorizada', () => {
    const context = buildRequestContext({ headers: { 'x-tenant-id': '7' } });
    expect(context.tenantId).toBeNull();
    expect(context.actor.type).toBe('anonymous');
    expect(() => requireTenant(context)).toThrow('REQUEST_CONTEXT_WITHOUT_TENANT');
  });

  it('es inmutable y lleva reloj inyectable', () => {
    const now = new Date('2026-09-11T00:00:00.000Z');
    const context = buildRequestContext({ now, correlationId: 'c' });
    expect(context.now).toBe(now);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.actor)).toBe(true);
  });
});
