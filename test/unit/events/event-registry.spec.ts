import { describe, expect, it } from '@jest/globals';
import { ALLOWED_TRANSITIONS } from '../../../src/modules/customers/customer-lifecycle.constants.js';
import { getEventDefinition, listEventDefinitions } from '../../../src/modules/events/event-registry.js';

/**
 * A8/B12 (plan de procesos, 2026-09-26): lo que el código escribe en el outbox tiene que estar en el
 * registro; si no, `process_outbox` lo marca procesado sin que nadie lo consuma.
 */
describe('EVENT_REGISTRY', () => {
  it('registra customer.lifecycle.<estado> para CADA destino de una transición legal', () => {
    const destinos = new Set(Object.values(ALLOWED_TRANSITIONS).flat());
    for (const estado of destinos) {
      const definicion = getEventDefinition(`customer.lifecycle.${estado}`);
      expect(definicion).toMatchObject({ family: 'customer_lifecycle' });
      // `createTransitionEvent` escribe el agregado `customer`.
      expect(definicion?.allowedAggregateTypes).toContain('customer');
    }
  });

  it('no registra estados a los que ninguna transición llega', () => {
    const destinos = new Set<string>(Object.values(ALLOWED_TRANSITIONS).flat());
    const registrados = listEventDefinitions()
      .filter((definicion) => definicion.family === 'customer_lifecycle')
      .map((definicion) => definicion.code.replace('customer.lifecycle.', ''));
    expect(registrados.filter((estado) => !destinos.has(estado))).toEqual([]);
  });

  it('kyc.approved y kyc.rejected admiten el agregado customer, que es el que usa el aviso del veredicto', () => {
    expect(getEventDefinition('kyc.approved')?.allowedAggregateTypes).toContain('customer');
    expect(getEventDefinition('kyc.rejected')?.allowedAggregateTypes).toContain('customer');
  });

  it('customer_onboarding.submitted NO es un evento: es un código de auditoría, y no se registra', () => {
    expect(getEventDefinition('customer_onboarding.submitted')).toBeNull();
  });
});
