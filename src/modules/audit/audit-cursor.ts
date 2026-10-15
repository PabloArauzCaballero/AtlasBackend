/**
 * @file Utilidad: cursor opaco (base64url) de la paginación del feed unificado de auditoría.
 * @business Esta pieza aporta trazabilidad verificable de acciones y cambios para investigación, cumplimiento y soporte.
 * @system consolida consultas y persistencia de eventos de auditoría sin exponer modelos ORM al transporte.
 */

export type AuditCursorKey = { occurredAt: string; sourceTable: string; sourceId: string };

export function encodeAuditCursor(key: AuditCursorKey): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

export function decodeAuditCursor(cursor: string | undefined): AuditCursorKey | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<AuditCursorKey>;
    if (typeof parsed.occurredAt !== 'string' || typeof parsed.sourceTable !== 'string' || typeof parsed.sourceId !== 'string') return null;
    return { occurredAt: parsed.occurredAt, sourceTable: parsed.sourceTable, sourceId: parsed.sourceId };
  } catch {
    return null;
  }
}
