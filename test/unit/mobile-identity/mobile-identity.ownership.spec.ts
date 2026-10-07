import { describe, expect, it, jest } from '@jest/globals';
import { MobileIdentityService } from '../../../src/modules/mobile-identity/mobile-identity.service.js';
import {
  identityVerificationIdParamsSchema,
  startIdentityVerificationSchema,
} from '../../../src/modules/mobile-identity/mobile-identity.schemas.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';

/**
 * De quién es una verificación.
 *
 * El identificador es un bigint secuencial y la respuesta lleva lo leído del carnet (número,
 * nombres, nacimiento). Hasta el 2026-10-05 `get` sólo filtraba por inquilino: un cliente con
 * sesión podía recorrer 1..N y leer el carnet de los demás. Lo que se fija aquí es que un cliente
 * sólo ve lo suyo, y que lo ajeno contesta EXACTAMENTE lo mismo que lo que no existe.
 */
describe('MobileIdentityService.get — propiedad del intento', () => {
  function montar(fila: Record<string, unknown> | null) {
    const repository = { findById: jest.fn(async (..._args: unknown[]) => fila) };
    const service = new MobileIdentityService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, repository };
  }

  const fila = (customerId: string | null) => ({
    id: '5501',
    customerId,
    finalResult: 'VERIFIED',
    selfieMatchScore: '0.91',
    reasonCodesJson: { reason: 'OK', extracted: { documentNumber: { value: '1234567', confidence: 0.99, source: 'OCR' } } },
    requestedAt: new Date('2026-10-05T12:00:00Z'),
    completedAt: new Date('2026-10-05T12:00:05Z'),
  });

  const cliente = (customerId: string | undefined): AuthenticatedUser =>
    ({ userId: `c-${customerId}`, tenantId: '1', role: 'customer', customerId }) as never;
  const operador = { userId: 'i-7', tenantId: '1', role: 'internal_operator', internalUserId: '7' } as never as AuthenticatedUser;

  const NO_ENCONTRADA = { status: 404, response: { code: 'IDENTITY_VERIFICATION_NOT_FOUND' } };

  it('el dueño ve su verificación, con lo leído del carnet', async () => {
    const { service } = montar(fila('42'));

    const vista = await service.get('1', '5501', cliente('42'));

    expect(vista.status).toBe('VERIFIED');
    expect(vista.extracted?.documentNumber?.value).toBe('1234567');
  });

  it('otro cliente del mismo inquilino recibe 404, no los datos ni un 403 que confirme que existe', async () => {
    const { service } = montar(fila('42'));

    await expect(service.get('1', '5501', cliente('43'))).rejects.toMatchObject(NO_ENCONTRADA);
  });

  it('un intento sin dueño no se le enseña a ningún cliente', async () => {
    const { service } = montar(fila(null));

    await expect(service.get('1', '5501', cliente('43'))).rejects.toMatchObject(NO_ENCONTRADA);
  });

  it('un token de cliente sin customerId no casa con un intento sin dueño', async () => {
    const { service } = montar(fila(null));

    await expect(service.get('1', '5501', cliente(undefined))).rejects.toMatchObject(NO_ENCONTRADA);
  });

  it('el personal interno ve el intento de cualquier cliente, y también el que no tiene dueño', async () => {
    await expect(montar(fila('42')).service.get('1', '5501', operador)).resolves.toMatchObject({ status: 'VERIFIED' });
    await expect(montar(fila(null)).service.get('1', '5501', operador)).resolves.toMatchObject({ status: 'VERIFIED' });
  });

  it('lo que no existe sigue siendo 404 para todos', async () => {
    await expect(montar(null).service.get('1', '5501', cliente('42'))).rejects.toMatchObject(NO_ENCONTRADA);
    await expect(montar(null).service.get('1', '5501', operador)).rejects.toMatchObject(NO_ENCONTRADA);
  });
});

describe('los identificadores del flujo móvil son bigint', () => {
  // Sin el patrón, «abc» llegaba a Postgres («invalid input syntax for type bigint») y volvía 500.
  it.each(['abc', '0', '-1', '1.5', '12 34', '', '1'.repeat(20)])('verificationId «%s» se rechaza en la validación', (valor) => {
    expect(identityVerificationIdParamsSchema.safeParse({ verificationId: valor }).success).toBe(false);
  });

  it('verificationId numérico pasa', () => {
    expect(identityVerificationIdParamsSchema.parse({ verificationId: ' 5501 ' }).verificationId).toBe('5501');
  });

  it('customerId sigue siendo opcional, pero si viene tiene que ser numérico', () => {
    const base = { documentFront: 'A'.repeat(120), selfie: 'A'.repeat(120) };

    expect(startIdentityVerificationSchema.parse(base).customerId).toBeUndefined();
    expect(startIdentityVerificationSchema.parse({ ...base, customerId: '42' }).customerId).toBe('42');
    expect(startIdentityVerificationSchema.safeParse({ ...base, customerId: 'C-12' }).success).toBe(false);
    expect(startIdentityVerificationSchema.safeParse({ ...base, customerId: '' }).success).toBe(false);
  });
});
