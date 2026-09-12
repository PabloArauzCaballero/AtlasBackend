import { describe, expect, it } from '@jest/globals';
import { derivePriority, mostUrgent, raiseTo } from '../../../src/modules/support/domain/priority-policy.js';

/** La prioridad la calcula la regla, no el ánimo del turno ni quién grita más fuerte. */
describe('matriz de prioridad', () => {
  it('una consulta individual sin apuro es P4', () => {
    expect(derivePriority({ impact: 'INDIVIDUAL', urgency: 'LOW', caseType: 'QUESTION' })).toBe('P4');
  });

  it('un problema individual normal es P3', () => {
    expect(derivePriority({ impact: 'INDIVIDUAL', urgency: 'NORMAL', caseType: 'BUG_REPORT' })).toBe('P3');
  });

  it('una caída de plataforma es P1 aunque la urgencia declarada sea normal', () => {
    expect(derivePriority({ impact: 'PLATFORM_WIDE', urgency: 'NORMAL', caseType: 'TECHNICAL_INCIDENT' })).toBe('P1');
  });

  it('un problema individual crítico sube a P2, no a P1: severidad no es prioridad', () => {
    expect(derivePriority({ impact: 'INDIVIDUAL', urgency: 'CRITICAL', caseType: 'TECHNICAL_INCIDENT' })).toBe('P2');
  });

  it('varios comercios bloqueados en una operación crítica es P1', () => {
    expect(derivePriority({ impact: 'MULTI_PARTNER', urgency: 'CRITICAL', caseType: 'PARTNER_OPERATION' })).toBe('P1');
  });

  it('varios comercios con urgencia alta pero sin criticidad declarada es P2', () => {
    // Alcance amplio no basta por sí solo: si hay rodeo, no desplaza a una caída en curso.
    expect(derivePriority({ impact: 'MULTI_PARTNER', urgency: 'HIGH', caseType: 'PARTNER_OPERATION' })).toBe('P2');
  });
});

describe('piso de prioridad de seguridad y fraude', () => {
  it('un reporte de fraude individual y sin apuro declarado no baja de P2', () => {
    expect(derivePriority({ impact: 'INDIVIDUAL', urgency: 'LOW', caseType: 'FRAUD_REPORT' })).toBe('P2');
  });

  it('una toma de cuenta declarada crítica es P1', () => {
    expect(derivePriority({ impact: 'INDIVIDUAL', urgency: 'CRITICAL', caseType: 'SECURITY_INCIDENT' })).toBe('P1');
  });

  it('un incidente de seguridad que afecta a más de una persona es P1', () => {
    expect(derivePriority({ impact: 'MULTI_USER', urgency: 'LOW', caseType: 'SECURITY_INCIDENT' })).toBe('P1');
  });

  it('un reclamo formal nunca queda como consulta informativa', () => {
    expect(derivePriority({ impact: 'INDIVIDUAL', urgency: 'LOW', caseType: 'COMPLAINT' })).toBe('P3');
  });
});

describe('utilidades de prioridad', () => {
  it('raiseTo sube hasta el piso pero nunca baja', () => {
    expect(raiseTo('P4', 'P2')).toBe('P2');
    expect(raiseTo('P1', 'P3')).toBe('P1');
  });

  it('mostUrgent devuelve la más exigente de las dos', () => {
    expect(mostUrgent('P3', 'P1')).toBe('P1');
    expect(mostUrgent('P2', 'P4')).toBe('P2');
  });
});
