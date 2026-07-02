import { Injectable } from '@nestjs/common';

function getPathValue(payload: Record<string, unknown>, path: string): string {
  const parts = path.split('.');
  let current: unknown = payload;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null || !(part in current)) return '';
    current = (current as Record<string, unknown>)[part];
  }
  if (current === null || current === undefined) return '';
  if (current instanceof Date) return current.toISOString();
  if (typeof current === 'object') return JSON.stringify(current);
  return String(current);
}

@Injectable()
export class NotificationTemplateRendererService {
  render(template: string | null | undefined, payload: Record<string, unknown>, fallback: string): string {
    const source = template && template.trim().length > 0 ? template : fallback;
    return source.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, path: string) => getPathValue(payload, path));
  }
}
