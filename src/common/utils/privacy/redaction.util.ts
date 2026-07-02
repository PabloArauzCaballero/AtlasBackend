const SENSITIVE_KEY_PATTERN =
  /(password|token|secret|authorization|cookie|otp|verificationCode|documentNumber|declaredNumber|encrypted|phone|email|lat|lng|gps|address|reference|rawPayload|evidence|storageKey|payload)/i;

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const input = value as Record<string, unknown>;
    return Object.keys(input)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = sortValue(input[key]);
        return accumulator;
      }, {});
  }

  return value;
}

export function redactSensitiveObject<T>(value: T, depth = 0): T | string {
  if (depth > 8) return '[REDACTED_MAX_DEPTH]';
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveObject(item, depth + 1)) as T;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(input)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactSensitiveObject(nestedValue, depth + 1);
    }
    return output as T;
  }
  return value;
}
