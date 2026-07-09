import { describe, expect, it } from '@jest/globals';
import { decodeAuditCursor, encodeAuditCursor } from '../../../src/modules/audit/audit.repository.js';

/**
 * ATLAS-P11-T06: primer test real para el código nuevo de `ATLAS-P11-T10` (vista unificada de
 * auditoría). Cubre el codec del cursor de forma aislada, sin necesidad de una base de datos:
 * es lógica pura (serializar/deserializar una tupla de paginación), exactamente el tipo de
 * unidad que sí se puede verificar por completo en este sandbox sin acceso a Postgres.
 */
describe('audit feed cursor codec', () => {
  it('round-trips a cursor key exactly', () => {
    const key = { occurredAt: '2026-07-01T10:00:00.000Z', sourceTable: 'fraud_case_event', sourceId: '42' };
    const encoded = encodeAuditCursor(key);
    expect(decodeAuditCursor(encoded)).toEqual(key);
  });

  it('returns null for an undefined cursor (first page)', () => {
    expect(decodeAuditCursor(undefined)).toBeNull();
  });

  it('returns null for a cursor that is not valid base64url JSON', () => {
    expect(decodeAuditCursor('not-a-valid-cursor')).toBeNull();
  });

  it('returns null when the decoded payload is missing required fields', () => {
    const incomplete = Buffer.from(JSON.stringify({ occurredAt: '2026-07-01T10:00:00.000Z' }), 'utf8').toString('base64url');
    expect(decodeAuditCursor(incomplete)).toBeNull();
  });

  it('returns null when a required field has the wrong type', () => {
    const wrongType = Buffer.from(
      JSON.stringify({ occurredAt: '2026-07-01T10:00:00.000Z', sourceTable: 'auth_event', sourceId: 42 }),
      'utf8',
    ).toString('base64url');
    expect(decodeAuditCursor(wrongType)).toBeNull();
  });

  it('produces different encodings for different source tables at the same timestamp', () => {
    const a = encodeAuditCursor({ occurredAt: '2026-07-01T10:00:00.000Z', sourceTable: 'auth_event', sourceId: '1' });
    const b = encodeAuditCursor({ occurredAt: '2026-07-01T10:00:00.000Z', sourceTable: 'consent_event', sourceId: '1' });
    expect(a).not.toBe(b);
  });

  it('is opaque: decoding garbage never throws, it degrades to null', () => {
    expect(() => decodeAuditCursor('====not-base64====')).not.toThrow();
    expect(decodeAuditCursor('====not-base64====')).toBeNull();
  });
});
