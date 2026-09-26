/**
 * @file Verifica la única normalización del resultado de identidad, sea el canal que sea.
 * @business Un cliente verificado no puede leerse como pendiente porque el canal que lo escribió usa otro casing.
 * @system Cubre `normalizeIdentityResult`, `isIdentityVerified`, `isTerminalIdentityResult`, `pickCurrentIdentityAttempt`,
 *   `pickAttemptAwaitingReview` e `identityResultForRow`.
 */
import { describe, expect, it } from '@jest/globals';
import {
  identityResultForRow,
  isIdentityVerified,
  isTerminalIdentityResult,
  normalizeIdentityResult,
  pickAttemptAwaitingReview,
  pickCurrentIdentityAttempt,
} from '../../../../src/common/utils/identity/identity-result.util.js';

describe('normalizeIdentityResult', () => {
  it('reconoce el veredicto en minúsculas del canal directo', () => {
    expect(normalizeIdentityResult('verified')).toBe('verified');
    expect(normalizeIdentityResult('rejected')).toBe('rejected');
    expect(normalizeIdentityResult('pending_review')).toBe('pending_review');
  });

  it('reconoce el mismo veredicto en MAYÚSCULAS del canal móvil (I-1)', () => {
    expect(normalizeIdentityResult('VERIFIED')).toBe('verified');
    expect(normalizeIdentityResult('REJECTED')).toBe('rejected');
  });

  it('trata IN_REVIEW y PENDING del móvil como el mismo "sin veredicto" que pending_review', () => {
    expect(normalizeIdentityResult('IN_REVIEW')).toBe('pending_review');
    expect(normalizeIdentityResult('PENDING')).toBe('pending_review');
  });

  it('no inventa un veredicto para un valor vacío o desconocido', () => {
    expect(normalizeIdentityResult(null)).toBe('unknown');
    expect(normalizeIdentityResult(undefined)).toBe('unknown');
    expect(normalizeIdentityResult('')).toBe('unknown');
    expect(normalizeIdentityResult('algo-que-no-existe')).toBe('unknown');
  });
});

describe('isIdentityVerified', () => {
  it('FALLA sin la normalización: hoy un `VERIFIED` en mayúsculas debe contar como verificado', () => {
    // Antes del fix, el código comparaba `finalResult === 'verified'` en estricto: un intento del
    // canal móvil, que escribe `VERIFIED`, se leía como NO verificado.
    expect(isIdentityVerified('VERIFIED')).toBe(true);
  });

  it('sigue contando lo del canal directo, en minúsculas', () => {
    expect(isIdentityVerified('verified')).toBe(true);
  });

  it('no cuenta un rechazo ni un pendiente, venga en el casing que venga', () => {
    expect(isIdentityVerified('REJECTED')).toBe(false);
    expect(isIdentityVerified('IN_REVIEW')).toBe(false);
    expect(isIdentityVerified(null)).toBe(false);
  });
});

describe('isTerminalIdentityResult', () => {
  it('verified y rejected son terminales', () => {
    expect(isTerminalIdentityResult('verified')).toBe(true);
    expect(isTerminalIdentityResult('REJECTED')).toBe(true);
  });

  it('PENDING, IN_REVIEW y UNAVAILABLE no son terminales (I-2)', () => {
    expect(isTerminalIdentityResult('PENDING')).toBe(false);
    expect(isTerminalIdentityResult('IN_REVIEW')).toBe(false);
    expect(isTerminalIdentityResult('UNAVAILABLE')).toBe(false);
    expect(isTerminalIdentityResult(null)).toBe(false);
  });
});

describe('pickCurrentIdentityAttempt', () => {
  it('FALLA sin el fix: un intento posterior no terminal no debe tapar un verified anterior (I-2)', () => {
    // Mismo caso que describe el plan: intento 1 `verified`, intento 2 (otro canal) `PENDING` y más
    // reciente. Ordenado por más reciente primero, como llega de la base.
    const attemptsNewestFirst = [{ finalResult: 'PENDING' }, { finalResult: 'verified' }];

    const current = pickCurrentIdentityAttempt(attemptsNewestFirst);

    expect(current).toEqual({ finalResult: 'verified' });
  });

  it('si nadie llegó a un veredicto, manda el más reciente', () => {
    const attemptsNewestFirst = [{ finalResult: 'IN_REVIEW' }, { finalResult: 'PENDING' }];
    expect(pickCurrentIdentityAttempt(attemptsNewestFirst)).toEqual({ finalResult: 'IN_REVIEW' });
  });

  it('una lista vacía no tiene intento vigente', () => {
    expect(pickCurrentIdentityAttempt([])).toBeNull();
  });

  it('un rechazo terminal también manda sobre un pendiente más nuevo', () => {
    const attemptsNewestFirst = [{ finalResult: 'IN_REVIEW' }, { finalResult: 'REJECTED' }];
    expect(pickCurrentIdentityAttempt(attemptsNewestFirst)).toEqual({ finalResult: 'REJECTED' });
  });
});

describe('pickAttemptAwaitingReview', () => {
  it('FALLA sin el fix: un verified más reciente de otro canal no es el intento que espera decisión (I-3)', () => {
    // Más reciente primero: el del móvil ya `VERIFIED` y, antes, el del paquete `pending_review`.
    const attemptsNewestFirst = [{ finalResult: 'VERIFIED' }, { finalResult: 'pending_review' }];

    expect(pickAttemptAwaitingReview(attemptsNewestFirst)).toEqual({ finalResult: 'pending_review' });
  });

  it('entre varios sin veredicto, el más reciente', () => {
    const attemptsNewestFirst = [{ finalResult: 'UNAVAILABLE' }, { finalResult: 'pending_review' }];
    expect(pickAttemptAwaitingReview(attemptsNewestFirst)).toEqual({ finalResult: 'UNAVAILABLE' });
  });

  it('si todos ya tienen veredicto, el más reciente (lo que había antes de esta regla)', () => {
    const attemptsNewestFirst = [{ finalResult: 'rejected' }, { finalResult: 'verified' }];
    expect(pickAttemptAwaitingReview(attemptsNewestFirst)).toEqual({ finalResult: 'rejected' });
  });

  it('una lista vacía no tiene ninguno', () => {
    expect(pickAttemptAwaitingReview([])).toBeNull();
  });
});

describe('identityResultForRow', () => {
  it('escribe en MAYÚSCULAS sobre una fila del canal móvil, que la app lee tal cual (I-3)', () => {
    expect(identityResultForRow('verified', 'IN_REVIEW')).toBe('VERIFIED');
    expect(identityResultForRow('rejected', 'UNAVAILABLE')).toBe('REJECTED');
  });

  it('escribe en minúsculas sobre una fila del canal directo', () => {
    expect(identityResultForRow('verified', 'pending_review')).toBe('verified');
    expect(identityResultForRow('rejected', 'pending_review')).toBe('rejected');
  });

  it('sin valor previo usa el vocabulario del canal directo', () => {
    expect(identityResultForRow('verified', null)).toBe('verified');
    expect(identityResultForRow('rejected', undefined)).toBe('rejected');
    expect(identityResultForRow('verified', '')).toBe('verified');
  });

  it('lo que escribe se lee de vuelta con el mismo veredicto, sea cual sea el vocabulario', () => {
    expect(normalizeIdentityResult(identityResultForRow('verified', 'IN_REVIEW'))).toBe('verified');
    expect(normalizeIdentityResult(identityResultForRow('rejected', 'pending_review'))).toBe('rejected');
  });
});
