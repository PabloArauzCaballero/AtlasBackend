import { createHash } from 'node:crypto';
import { redactSensitiveObject, stableStringify } from '../../common/utils/privacy/redaction.util.js';

export function sanitizeForSystemsOps(value: unknown): Record<string, unknown> {
  const redacted = redactSensitiveObject(value ?? {});
  return redacted && typeof redacted === 'object' && !Array.isArray(redacted) ? (redacted as Record<string, unknown>) : { value: redacted };
}

export function hashPayload(value: unknown): string {
  return createHash('sha256')
    .update(stableStringify(value ?? {}))
    .digest('hex');
}

export function idempotencyLast4(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(-4);
}
