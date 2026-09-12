import { describe, expect, it } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import {
  assertTransition,
  canAutoClose,
  canTransition,
  customerVisibleStatus,
  isTerminalStatus,
  isWaitingStatus,
} from '../../../src/modules/support/domain/case-state-machine.js';

/**
 * La máquina de estados del caso: lo que impide que un expediente salte de «recibido» a «cerrado»
 * sin haber sido resuelto ni comunicado.
 */
describe('máquina de estados del caso de soporte', () => {
  it('permite el camino normal de atención', () => {
    expect(canTransition('NEW', 'TRIAGED')).toBe(true);
    expect(canTransition('TRIAGED', 'ASSIGNED')).toBe(true);
    expect(canTransition('ASSIGNED', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'RESOLVED')).toBe(true);
    expect(canTransition('RESOLVED', 'CLOSED')).toBe(true);
  });

  it('rechaza cerrar un caso que nunca se trabajó', () => {
    expect(canTransition('NEW', 'CLOSED')).toBe(false);
    expect(canTransition('TRIAGED', 'RESOLVED')).toBe(false);
  });

  /**
   * Este par salió de probarlo de punta a punta: el agente tomaba el caso, respondía y al resolver
   * recibía un 409. Responder es trabajar, así que el mensaje público del agente mueve el caso a
   * `IN_PROGRESS`; la regla de aquí es la que obliga a ese paso intermedio.
   */
  it('no se resuelve un caso recién asignado sin haberlo trabajado', () => {
    expect(canTransition('ASSIGNED', 'RESOLVED')).toBe(false);
    expect(canTransition('ASSIGNED', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'RESOLVED')).toBe(true);
  });

  it('desde CLOSED sólo se puede reabrir', () => {
    expect(canTransition('CLOSED', 'REOPENED')).toBe(true);
    expect(canTransition('CLOSED', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('CLOSED', 'RESOLVED')).toBe(false);
  });

  it('una transición imposible falla con 409 y dice desde dónde', () => {
    expect(() => assertTransition('NEW', 'CLOSED')).toThrow(ConflictException);
    try {
      assertTransition('NEW', 'CLOSED');
    } catch (error) {
      const response = (error as ConflictException).getResponse() as Record<string, unknown>;
      expect(response.code).toBe('SUPPORT_CASE_STATE_CONFLICT');
      expect(response.from).toBe('NEW');
      expect(response.allowed).toContain('TRIAGED');
    }
  });

  it('reasignar el mismo estado no es un conflicto', () => {
    expect(() => assertTransition('IN_PROGRESS', 'IN_PROGRESS')).not.toThrow();
  });

  it('clasifica los estados terminales y los de espera', () => {
    expect(isTerminalStatus('CLOSED')).toBe(true);
    expect(isTerminalStatus('RESOLVED')).toBe(false);
    expect(isWaitingStatus('WAITING_CUSTOMER')).toBe(true);
    expect(isWaitingStatus('IN_PROGRESS')).toBe(false);
  });

  it('traduce el estado interno a algo que una persona entiende', () => {
    expect(customerVisibleStatus('WAITING_INTERNAL')).toBe('Estamos investigando');
    expect(customerVisibleStatus('NEW')).toBe('Recibido');
    // Escalado y esperando a un equipo interno se ven igual: al cliente no le importa el organigrama.
    expect(customerVisibleStatus('ESCALATED')).toBe(customerVisibleStatus('WAITING_INTERNAL'));
  });
});

describe('cierre automático por silencio del cliente', () => {
  const base = { status: 'RESOLVED' as const, legalHold: false, hasCommunicatedResolution: true };

  it('cierra una consulta resuelta y comunicada', () => {
    expect(canAutoClose({ ...base, caseType: 'QUESTION' })).toBe(true);
  });

  it('nunca cierra solo un incidente de seguridad, un fraude, un reclamo ni una solicitud de privacidad', () => {
    for (const caseType of ['SECURITY_INCIDENT', 'FRAUD_REPORT', 'COMPLAINT', 'PRIVACY_REQUEST'] as const) {
      expect(canAutoClose({ ...base, caseType })).toBe(false);
    }
  });

  it('el bloqueo legal impide el cierre automático de cualquier caso', () => {
    expect(canAutoClose({ ...base, caseType: 'QUESTION', legalHold: true })).toBe(false);
  });

  it('no cierra sin haber comunicado la resolución', () => {
    expect(canAutoClose({ ...base, caseType: 'QUESTION', hasCommunicatedResolution: false })).toBe(false);
  });

  it('no cierra un caso que todavía se está trabajando', () => {
    expect(canAutoClose({ ...base, status: 'IN_PROGRESS', caseType: 'QUESTION' })).toBe(false);
  });
});
