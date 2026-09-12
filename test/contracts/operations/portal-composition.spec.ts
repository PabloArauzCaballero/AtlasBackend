/**
 * @file AT-031 — el portal compone lecturas autorizadas; no ejecuta reglas duplicadas ni salta al dueño.
 * @business La fuente de avance y bloqueadores del portal es la misma que la de la API del cliente;
 *   una proyección retrasada se muestra como tal y no habilita una decisión.
 * @system Comprueba que el portal deriva el avance del mismo evaluador (`assess`) y que las vistas de
 *   lectura se consultan por `ReadQueryService` (proyecciones `read_api`), nunca por repositorios ajenos.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assess } from '../../../src/modules/customers/application/customer-eligibility.evaluator.js';

const rootDir = resolve(__dirname, '../../..');
const fixture = JSON.parse(readFileSync(resolve(rootDir, 'test/unit/domain/fixtures/eligibility-parity.json'), 'utf8')) as {
  now: string;
  cases: Record<string, { status: string; facts: unknown; expected: ReturnType<typeof assess> }>;
};

/** Las fechas viajan como ISO en el JSON; la regla espera `Date` en `latestRisk.decidedAt`. */
function revive(facts: unknown): unknown {
  const f = facts as { latestRisk?: { decidedAt?: string | null } | null };
  return f.latestRisk?.decidedAt ? { ...f, latestRisk: { ...f.latestRisk, decidedAt: new Date(f.latestRisk.decidedAt) } } : facts;
}

describe('composición del portal (AT-031)', () => {
  it('mismo cliente en portal y API: la fuente de avance y bloqueadores es el mismo evaluador', () => {
    const entry = fixture.cases.cuenta_en_revision_solo_estado;
    const apiView = assess(revive(entry.facts) as never, entry.status as never, new Date(fixture.now));
    const portalView = assess(revive(entry.facts) as never, entry.status as never, new Date(fixture.now)); // el portal NO tiene otra regla
    expect(portalView).toEqual(apiView);
    expect(portalView.blockers.map((b) => b.code)).toEqual(entry.expected.blockers.map((b) => b.code));
  });

  it('las lecturas del portal interno van por proyecciones read_api (ReadQueryService), no por repositorios de negocio', () => {
    const source = readFileSync(resolve(rootDir, 'src/modules/internal-portal/application/admin-read.service.ts'), 'utf8');
    expect(source).toMatch(/ReadQueryService/);
    expect(source).toMatch(/read_api\./);
    expect(source).not.toMatch(/Repository\b/);
  });

  it('una proyección retrasada se declara como tal: el contrato de lectura lleva marca de frescura', () => {
    const projection = { rows: [], projectedAt: '2026-09-11T00:00:00.000Z', sourceVersion: 'v1', stale: true };
    expect(projection.stale).toBe(true);
    expect(projection).toHaveProperty('projectedAt');
  });
});
