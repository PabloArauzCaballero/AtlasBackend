import { describe, expect, it } from '@jest/globals';
import {
  allowedTransitions,
  DATA_SUBJECT_REQUEST_DUE_DAYS,
  dueDateFrom,
  evaluateTransition,
  isOverdue,
} from '../../../src/modules/customer-privacy/data-subject-request.state.js';

/**
 * La máquina de estados de una solicitud del titular (hallazgo A5). Se fija lo que se equivoca en
 * silencio: un salto que no debería existir, un cierre sin motivo y un «vencida» que marca lo ya
 * cerrado o que cuenta días hábiles en vez de naturales.
 */
describe('máquina de estados de la solicitud del titular', () => {
  it('received sólo va a in_progress; in_progress a completed o rejected; los finales no salen', () => {
    expect(allowedTransitions('received')).toEqual(['in_progress']);
    expect(allowedTransitions('in_progress')).toEqual(['completed', 'rejected']);
    expect(allowedTransitions('completed')).toEqual([]);
    expect(allowedTransitions('rejected')).toEqual([]);
    expect(allowedTransitions(null)).toEqual(['in_progress']);
    expect(allowedTransitions('desconocido')).toEqual([]);
  });

  it('PRUEBA EN NEGATIVO — no se cierra sin haberla tomado', () => {
    expect(evaluateTransition('received', 'completed', 'Entregada la copia de datos.')).toEqual({
      ok: false,
      code: 'DATA_SUBJECT_REQUEST_INVALID_TRANSITION',
    });
    expect(evaluateTransition('completed', 'in_progress', undefined)).toEqual({
      ok: false,
      code: 'DATA_SUBJECT_REQUEST_INVALID_TRANSITION',
    });
  });

  it('cerrar exige motivo; tomarla no', () => {
    expect(evaluateTransition('in_progress', 'rejected', undefined)).toEqual({ ok: false, code: 'DATA_SUBJECT_REQUEST_REASON_REQUIRED' });
    expect(evaluateTransition('in_progress', 'completed', '   ')).toEqual({ ok: false, code: 'DATA_SUBJECT_REQUEST_REASON_REQUIRED' });
    expect(evaluateTransition('in_progress', 'completed', 'Copia entregada por correo.')).toEqual({ ok: true, terminal: true });
    expect(evaluateTransition('received', 'in_progress', undefined)).toEqual({ ok: true, terminal: false });
  });

  it('vence a 15 días NATURALES de la recepción', () => {
    expect(DATA_SUBJECT_REQUEST_DUE_DAYS).toBe(15);
    expect(dueDateFrom(new Date('2026-09-01T10:00:00.000Z')).toISOString()).toBe('2026-09-16T10:00:00.000Z');
  });

  it('vencida = abierta y fuera de plazo; una cerrada tarde no cuenta como vencida', () => {
    const recibida = new Date('2026-09-01T10:00:00.000Z');
    const antes = new Date('2026-09-16T09:59:59.000Z');
    const despues = new Date('2026-09-16T10:00:01.000Z');
    expect(isOverdue('received', recibida, antes)).toBe(false);
    expect(isOverdue('received', recibida, despues)).toBe(true);
    expect(isOverdue('in_progress', recibida, despues)).toBe(true);
    expect(isOverdue('completed', recibida, despues)).toBe(false);
    expect(isOverdue('rejected', recibida, despues)).toBe(false);
  });
});
