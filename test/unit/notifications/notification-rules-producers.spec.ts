import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { NotificationRulesService } from '../../../src/modules/notifications/notification-rules.service.js';

/**
 * Guardián: una regla de aviso sin quien publique su evento no avisa a nadie y hace creer que sí.
 *
 * Al 2026-09-29, 19 de las 26 reglas de `notification-rules.service.ts` no tenían productor en `src/`
 * (entre ellas `installment.overdue`, marcada como aviso de mora irrenunciable). Aquí se busca, para
 * cada regla, el código del evento como literal en el código de la aplicación, EXCLUYENDO los lugares
 * que sólo lo nombran sin publicarlo: la propia tabla de reglas, el registro de eventos, los catálogos
 * documentales y las migraciones.
 */
const SRC = join(__dirname, '../../../src');
const NAMES_WITHOUT_PUBLISHING = [
  'modules/notifications/notification-rules.service.ts',
  'modules/events/event-registry.ts',
  'modules/workflow-catalog/',
  'modules/systems-ops/',
  'database/migrations/',
  'database/seeders/',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

/** Los archivos de `src/` que contienen `code` entre comillas, sin contar los que sólo lo nombran. */
function producersOf(code: string, files: Array<{ path: string; text: string }>): string[] {
  const literal = new RegExp(`['"\`]${code.replaceAll('.', '\\.')}['"\`]`);
  return files
    .filter(({ path }) => !NAMES_WITHOUT_PUBLISHING.some((excluded) => path.startsWith(excluded)))
    .filter(({ text }) => literal.test(text))
    .map(({ path }) => path);
}

const FILES = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, 'utf8') }));

describe('guardián de productores de las reglas de aviso', () => {
  it('cada regla declarada tiene al menos un archivo de src/ que publica su evento', () => {
    const sinProductor = new NotificationRulesService().listRuleEventCodes().filter((code) => producersOf(code, FILES).length === 0);
    expect(sinProductor).toEqual([]);
  });

  /* En negativo: los códigos retirados y uno inventado NO tienen productor, así que el guardián los detectaría. */
  it('detecta un evento sin productor (los retirados y uno inventado)', () => {
    expect(producersOf('installment.overdue', FILES)).toEqual([]);
    expect(producersOf('merchant.settlement.ready', FILES)).toEqual([]);
    expect(producersOf('inventado.sin.productor', FILES)).toEqual([]);
  });

  it('no confunde la mención en la propia tabla con un productor', () => {
    const conRegla = [{ path: 'modules/notifications/notification-rules.service.ts', text: "'kyc.approved'" }];
    expect(producersOf('kyc.approved', conRegla)).toEqual([]);
    expect(producersOf('kyc.approved', [{ path: 'modules/x/publisher.ts', text: "eventCode: 'kyc.approved'" }])).toEqual([
      'modules/x/publisher.ts',
    ]);
  });
});
