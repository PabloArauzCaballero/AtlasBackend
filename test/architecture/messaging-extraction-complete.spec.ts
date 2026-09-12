/**
 * @file AT-061 — los accesos heredados a Mensajería sólo pueden encoger, y el piloto no reabre ninguno.
 * @business Reintroducir un import profundo de `NotificationsRepository` desde otro módulo, ampliar las
 *   exportaciones legadas de `NotificationsModule` o dar al rol de Mensajería permisos sobre Crédito/IAM
 *   devolvería el piloto al monolito sin que nadie lo note. Y el estado del piloto no puede decir «listo»
 *   mientras haya un bloqueo abierto.
 * @system Lee las fuentes: importadores de internos de Mensajería fuera del módulo (línea base congelada),
 *   exportaciones legadas del módulo (sólo encogen), grants del guion de roles, `pilot-readiness.json`
 *   coherente, y la raíz del worker sin módulos prohibidos.
 */
import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import 'reflect-metadata';
import { MESSAGING_FORBIDDEN_MODULES, MessagingWorkerModule } from '../../src/bootstrap/messaging-worker.module.js';

const ROOT = join(__dirname, '..', '..');

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) out.push(path);
  }
  return out;
}

/** Importa un interno de Mensajería (no `public/`): `../notifications/x`, `../../modules/notifications/x`. */
const INTERNAL_IMPORT = /from\s+'[^']*\/notifications\/(?!public\/)[^']+'/;

/** Línea base congelada (2026-09-12): quién sigue entrando por dentro y qué lo retira. Sólo puede encoger. */
const LEGACY_IMPORTERS: Readonly<Record<string, string>> = {
  'src/modules/runtime-jobs/runtime-maintenance-jobs.service.ts': 'AT-025 (jobs de entrega por puerto)',
  'src/modules/runtime-jobs/runtime-jobs.module.ts': 'AT-025',
  'src/modules/customer-onboarding/customer-onboarding.module.ts': 'AT-040 (OTP compuesto en Onboarding)',
  'src/modules/mail-sender/mail-sender.client.ts': 'AT-040 (ciclo auth-mail)',
  'src/modules/mail-sender/gmail-mail.transport.ts': 'AT-040',
  'src/modules/mail-sender/webhook-mail.transport.ts': 'AT-040',
  'src/modules/mail-sender/mail-sender.module.ts': 'AT-040',
  'src/modules/systems-ops/systems-ops.module.ts': 'monitor de salud avisa por Mensajería',
  'src/modules/systems-ops/systems-health-monitor.service.ts': 'monitor de salud avisa por Mensajería',
  'src/modules/events/events.module.ts': 'relay v1 (se retira con EVENTS_RELAY_V2_ENABLED por defecto)',
  'src/modules/events/events.service.ts': 'relay v1',
  'src/bootstrap/worker.module.ts': 'raíz del worker del monolito (compone NotificationsModule)',
  'src/bootstrap/messaging-worker.module.ts': 'raíz del piloto: compone el contexto a mano (es su dueño)',
  'src/database/database-models.ts': 'registro agregado de modelos mientras se comparte proceso (AT-018)',
  'src/app.module.ts': 'fachada del monolito: compone NotificationsModule (AT-045)',
  'src/modules/customer-onboarding/application/contact-verification-code.service.ts':
    'AT-040 (fallback legado a los adaptadores SMS/WhatsApp cuando no hay OtpDeliveryPort)',
};

/** Exportaciones legadas de `NotificationsModule` (AT-017): sólo pueden encoger. */
const LEGACY_EXPORTS = [
  'NotificationOrchestratorService',
  'NotificationPoliciesRepository',
  'NotificationsService',
  'NotificationsRepository',
  'NotificationBroadcastService',
  'SmsNotificationAdapter',
  'WhatsAppNotificationAdapter',
  'GmailMailModule',
];

describe('AT-061 · accesos heredados de Mensajería', () => {
  it('ningún módulo NUEVO importa internos de Mensajería; la línea base sólo encoge', () => {
    const importers = sources(join(ROOT, 'src'))
      .filter((file) => !file.includes(`${join('src', 'modules', 'notifications')}${'/'}`))
      .filter((file) => INTERNAL_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file))
      .sort();
    const fresh = importers.filter((file) => !(file in LEGACY_IMPORTERS));
    expect(fresh).toEqual([]);
    expect(Object.keys(LEGACY_IMPORTERS).filter((file) => !importers.includes(file))).toEqual([]);
  });

  it('las exportaciones legadas de NotificationsModule no crecen', () => {
    const source = readFileSync(join(ROOT, 'src/modules/notifications/notifications.module.ts'), 'utf8');
    const block = source.slice(source.indexOf('exports: ['), source.indexOf('],', source.indexOf('exports: [')));
    const exported = [...block.matchAll(/^\s*([A-Za-z_]+),?\s*$/gm)].map((match) => match[1]);
    const legacy = exported.filter((name) => !['NOTIFICATION_REQUEST_PORT', 'RECIPIENT_DIRECTORY_PORT', 'EVENT_CONSUMERS'].includes(name));
    expect(legacy.filter((name) => !LEGACY_EXPORTS.includes(name))).toEqual([]);
  });

  it('el rol de Mensajería no recibe grants sobre credit, customer ni iam en el guion de roles', () => {
    const sql = readFileSync(join(ROOT, 'ops/postgres/context-roles.sql'), 'utf8');
    expect(sql).toMatch(/'atlas_ctx_messaging',\s*'messaging'/);
    for (const schema of ['credit', 'customer', 'iam']) {
      expect(sql).not.toMatch(new RegExp(`GRANT[^;]*ON (ALL TABLES IN )?SCHEMA ${schema}[^;]*atlas_ctx_messaging`, 'i'));
    }
  });

  it('la raíz del piloto no importa módulos del monolito', () => {
    const list = (Reflect.getMetadata('imports', MessagingWorkerModule) ?? []) as unknown[];
    const names = list.map((entry) =>
      typeof entry === 'function' ? entry.name : ((entry as { module?: { name: string } }).module?.name ?? 'dynamic'),
    );
    for (const forbidden of MESSAGING_FORBIDDEN_MODULES) expect(names).not.toContain(forbidden);
  });

  it('pilot-readiness.json es coherente: NOT_READY mientras haya un bloqueo o pendiente', () => {
    const readiness = JSON.parse(readFileSync(join(ROOT, 'docs/architecture/microservices/pilot-readiness.json'), 'utf8')) as {
      decision: string;
      checks: Array<{ id: string; status: string }>;
    };
    const open = readiness.checks.filter((check) => check.status !== 'PASS');
    expect(readiness.decision).toBe(open.length > 0 ? 'NOT_READY' : 'READY');
    expect(readiness.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining(['no-sql-to-credit-iam-customer', 'recipient-directory-over-http', 'rollback-of-data']),
    );
  });
});
