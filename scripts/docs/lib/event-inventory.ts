/**
 * @file Inventario de eventos de dominio: lo que declara `EVENT_REGISTRY` y quién los EMITE de verdad.
 * @business Un consumidor sólo debe esperar los eventos que algún código publica; el resto es reserva.
 * @system cruza el registro con los productores reales de `src/` y con las reglas de canal.
 *
 * «Emitido» se calcula, no se declara: un código cuenta como emitido si su literal aparece en código de
 * producción de `src/` FUERA de los sitios que sólo lo nombran sin publicarlo (el propio registro, las
 * reglas de canal que lo consumen, las fichas de procesos que lo documentan, las semillas de
 * demostración, las suscripciones de entrega que lo reenvían). También cuenta un productor con
 * plantilla (`customer.lifecycle.${estado}`): emite todos los códigos registrados con ese prefijo.
 * Cada evento lleva la lista de archivos productores para que la revisión pueda comprobarlo.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { EVENT_REGISTRY } from '../../../src/modules/events/event-registry.js';
import type { EventRegistryItem } from '../../../src/modules/events/event-types.js';
import { NotificationRulesService } from '../../../src/modules/notifications/notification-rules.service.js';

const ROOT = process.cwd();

/**
 * Archivos y carpetas que NOMBRAN códigos de evento sin publicarlos. Añadir aquí un archivo es afirmar
 * que no emite: la revisión debe poder comprobarlo leyéndolo.
 */
export const NON_PRODUCER_PATHS: ReadonlyArray<{ path: string; why: string }> = [
  { path: 'src/modules/events/event-registry.ts', why: 'el registro: declara, no publica' },
  { path: 'src/modules/notifications/notification-rules.service.ts', why: 'reglas de canal: consumen' },
  { path: 'src/modules/workflow-catalog/definitions/', why: 'fichas de procesos: documentan' },
  { path: 'src/modules/systems-ops/entity-narratives/', why: 'narrativas del catálogo: documentan' },
  { path: 'src/database/seeders/', why: 'semillas de demostración: datos, no productores' },
  { path: 'src/database/migrations/', why: 'migraciones: esquema y datos, no productores' },
  { path: 'src/platform/events/outbound-subscriptions.ts', why: 'suscripciones de entrega al ERP: reenvían lo ya emitido' },
  { path: 'src/platform/events/outbound-envelope.ts', why: 'forma del sobre de entrega al ERP: reenvía lo ya emitido' },
];

export type EventInventoryItem = EventRegistryItem & {
  emitted: boolean;
  producers: string[];
  /** Canales y destinatario según `NotificationRulesService`; vacío = se consume sin mensaje. */
  notifications: Array<{ recipientType: string; channels: readonly string[] }>;
};

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) found.push(full);
  }
  return found;
}

function isNonProducer(file: string): boolean {
  return NON_PRODUCER_PATHS.some((entry) => (entry.path.endsWith('/') ? file.startsWith(entry.path) : file === entry.path));
}

/** Prefijos de plantillas `familia.sub.${…}` escritas como código de evento (`eventCode:`/`type:`). */
function templatePrefixes(source: string): string[] {
  const prefixes: string[] = [];
  for (const match of source.matchAll(/\b(?:eventCode|type)\s*:\s*`([a-z_]+(?:\.[a-z_]+)*\.)\$\{/g)) prefixes.push(match[1]);
  return prefixes;
}

function producersByCode(codes: readonly string[]): Map<string, Set<string>> {
  const producers = new Map<string, Set<string>>(codes.map((code) => [code, new Set<string>()]));
  for (const full of sourceFiles(resolve(ROOT, 'src'))) {
    const file = relative(ROOT, full).replace(/\\/g, '/');
    if (isNonProducer(file)) continue;
    const source = readFileSync(full, 'utf8');
    const prefixes = templatePrefixes(source);
    for (const code of codes) {
      const literal = source.includes(`'${code}'`) || source.includes(`"${code}"`);
      if (literal || prefixes.some((prefix) => code.startsWith(prefix))) producers.get(code)?.add(file);
    }
  }
  return producers;
}

export function loadEventInventory(): EventInventoryItem[] {
  const items = Object.values(EVENT_REGISTRY);
  const producers = producersByCode(items.map((item) => item.code));
  const rules = new NotificationRulesService();
  return items.map((item) => {
    const files = [...(producers.get(item.code) ?? [])].sort();
    const notifications = rules.getRulesForEvent(item.code).map((rule) => ({ recipientType: rule.recipientType, channels: rule.channels }));
    return { ...item, emitted: files.length > 0, producers: files, notifications };
  });
}

/** Familias en el orden en que las declara el registro. */
export function familiesOf(items: readonly EventInventoryItem[]): string[] {
  return [...new Set(items.map((item) => item.family))];
}
