/**
 * @file Un 200 con el contrato roto no puede salir como evidencia válida.
 * @business Un proveedor que deja de mandar `matchScore` no puede producir una identidad "verificada
 *   con confianza 0": tiene que producir un fallo con nombre y sin observaciones.
 * @system `validateProviderResponse` y su motivo legible.
 */
import { describe, expect, it } from '@jest/globals';
import { contractViolationReason, validateProviderResponse } from '../../../src/modules/external-data/domain/provider-response.contract.js';

describe('contrato de respuesta de proveedor', () => {
  const segipCompleto = {
    status: 'FOUND',
    documentExists: true,
    matchScore: 0.97,
    nameMatches: true,
    birthDateMatches: true,
    providerReference: 'SEGIP-MOCK-1',
  };

  it('una respuesta completa no tiene violaciones', () => {
    expect(validateProviderResponse('SEGIP', segipCompleto, 'FOUND')).toEqual([]);
  });

  it('el caso del paquete QA: 200 FOUND sin un solo dato de la verificación', () => {
    const violations = validateProviderResponse('SEGIP', { status: 'FOUND' }, 'FOUND');
    expect(violations.map((violation) => violation.field).sort()).toEqual([
      'birthDateMatches',
      'documentExists',
      'matchScore',
      'nameMatches',
      'providerReference',
    ]);
  });

  it('un campo con el tipo equivocado es una violación, no una conversión', () => {
    const violations = validateProviderResponse('SEGIP', { ...segipCompleto, matchScore: '0.97' }, 'FOUND');
    expect(violations).toEqual([{ field: 'matchScore', expected: 'number', received: 'string' }]);
  });

  it('`null` no cuenta como valor presente', () => {
    const violations = validateProviderResponse('SEGIP', { ...segipCompleto, documentExists: null }, 'FOUND');
    expect(violations).toEqual([{ field: 'documentExists', expected: 'boolean', received: 'null' }]);
  });

  it('un NaN no pasa por número: JSON no lo representa y sólo puede venir de una conversión rota', () => {
    const violations = validateProviderResponse('SEGIP', { ...segipCompleto, matchScore: Number.NaN }, 'FOUND');
    expect(violations).toEqual([{ field: 'matchScore', expected: 'number', received: 'number' }]);
  });

  it('una cadena vacía no es un providerReference', () => {
    const violations = validateProviderResponse('SEGIP', { ...segipCompleto, providerReference: '' }, 'FOUND');
    expect(violations).toEqual([{ field: 'providerReference', expected: 'string', received: 'string' }]);
  });

  it('CGIP se valida como SEGIP: son el mismo proveedor con dos nombres', () => {
    expect(validateProviderResponse('CGIP', segipCompleto, 'FOUND')).toEqual([]);
    expect(validateProviderResponse('CGIP', { status: 'FOUND' }, 'FOUND').length).toBeGreaterThan(0);
  });

  it('QR_BCB_GENERIC se valida como QR_GENERIC', () => {
    const payload = { status: 'PAYMENT_VERIFIED', amountMatches: true, referenceMatches: true, providerReference: 'QR-1' };
    expect(validateProviderResponse('QR_BCB_GENERIC', payload, 'PAYMENT_VERIFIED')).toEqual([]);
  });

  it('un veredicto de fallo no exige datos de negocio: el proveedor no llegó a producirlos', () => {
    expect(validateProviderResponse('SEGIP', { status: 'PROVIDER_UNAVAILABLE' }, 'PROVIDER_UNAVAILABLE')).toEqual([]);
  });

  it('DATA_NOT_AVAILABLE no exige el dato que el proveedor dice no tener', () => {
    expect(validateProviderResponse('INFOCENTER', { status: 'DATA_NOT_AVAILABLE' }, 'DATA_NOT_AVAILABLE')).toEqual([]);
  });

  it('un proveedor sin contrato declarado no se bloquea', () => {
    // Endurecer lo que se conoce, sin convertir cada proveedor nuevo en una caída hasta que alguien
    // lo agregue a la tabla.
    expect(validateProviderResponse('PROVEEDOR_NUEVO', { status: 'COMPLETED' }, 'COMPLETED')).toEqual([]);
  });

  it('el motivo nombra los campos: sin eso hay que reproducir la llamada para diagnosticar', () => {
    const violations = validateProviderResponse('INFOCENTER', { status: 'COMPLETED', bureauScore: 700 }, 'COMPLETED');
    const reason = contractViolationReason(violations);
    expect(reason).toContain('PROVIDER_CONTRACT_VIOLATION');
    expect(reason).toContain('activeDebtCount:number→undefined');
  });
});
