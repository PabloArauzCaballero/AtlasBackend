import { describe, expect, it } from '@jest/globals';
import { containsUnredactedSecret, redactSensitive, REDACTED } from '../../../scripts/smoke/redact.js';

const SAMPLE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0Iiwicm9sZSI6ImN1c3RvbWVyIn0.RfRM36QEWot8fU89Zy_eFj2CNsVf7KRCtPLVX7t-XtA';

describe('redactSensitive', () => {
  it('redacts sensitive keys regardless of case', () => {
    const input = { Password: 'x', ACCESSTOKEN: 'y', refreshToken: 'z' };
    expect(redactSensitive(input)).toEqual({ Password: REDACTED, ACCESSTOKEN: REDACTED, refreshToken: REDACTED });
  });

  it('redacts sensitive keys nested inside arrays', () => {
    const input = { list: [{ password: 'x' }, { keep: 'ok' }] };
    expect(redactSensitive(input)).toEqual({ list: [{ password: REDACTED }, { keep: 'ok' }] });
  });

  it('redacts a full JWT value even under a non-sensitive key name', () => {
    const input = { note: SAMPLE_JWT };
    expect(redactSensitive(input)).toEqual({ note: REDACTED });
  });

  it('redacts a JWT embedded inside a larger string, keeping the surrounding text', () => {
    const input = { message: `token issued: ${SAMPLE_JWT} please store it` };
    expect(redactSensitive(input)).toEqual({ message: `token issued: ${REDACTED} please store it` });
  });

  it('redacts a Bearer header value', () => {
    const input = { header: `Bearer ${SAMPLE_JWT}` };
    expect(redactSensitive(input)).toEqual({ header: `Bearer ${REDACTED}` });
  });

  it('redacts a PEM private key block', () => {
    const input = { key: '-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBgkqhkiG\n-----END PRIVATE KEY-----' };
    expect(redactSensitive(input)).toEqual({ key: REDACTED });
  });

  it('redacts credentials embedded in a URL', () => {
    const input = { url: 'postgres://user:s3cr3t@localhost:5432/db' };
    expect(redactSensitive(input)).toEqual({ url: `postgres://${REDACTED}@localhost:5432/db` });
  });

  it('preserves non-sensitive fields untouched', () => {
    const input = { harmless: 'value', count: 3, active: true, empty: null };
    expect(redactSensitive(input)).toEqual(input);
  });

  it('does not mutate the original object', () => {
    const input = { password: 'x', nested: { accessToken: 'y' } };
    const snapshotBefore = JSON.parse(JSON.stringify(input));
    redactSensitive(input);
    expect(input).toEqual(snapshotBefore);
  });

  it('preserves array/object structure shape', () => {
    const input = { calls: [{ status: 200, password: 'x' }, { status: 404 }] };
    const result = redactSensitive(input) as typeof input;
    expect(Array.isArray(result.calls)).toBe(true);
    expect(result.calls).toHaveLength(2);
    expect(result.calls[0].status).toBe(200);
    expect(result.calls[1].status).toBe(404);
  });
});

describe('containsUnredactedSecret', () => {
  it('detects a raw JWT left in a serialized JSON string', () => {
    expect(containsUnredactedSecret(JSON.stringify({ token: SAMPLE_JWT }))).toBe(true);
  });

  it('detects a raw Bearer header left in a serialized JSON string', () => {
    expect(containsUnredactedSecret(JSON.stringify({ header: `Bearer ${SAMPLE_JWT}` }))).toBe(true);
  });

  it('returns false once the value has been redacted', () => {
    const redacted = redactSensitive({ token: SAMPLE_JWT, header: `Bearer ${SAMPLE_JWT}` });
    expect(containsUnredactedSecret(JSON.stringify(redacted))).toBe(false);
  });

  it('returns false for ordinary content with no secret-shaped patterns', () => {
    expect(containsUnredactedSecret(JSON.stringify({ status: 200, name: 'ok' }))).toBe(false);
  });
});
