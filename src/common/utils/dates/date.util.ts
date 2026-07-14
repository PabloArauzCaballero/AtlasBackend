export function toIsoOrNull(date: Date | string | null): string | null {
  if (!date) return null;
  return date instanceof Date ? date.toISOString() : date;
}
