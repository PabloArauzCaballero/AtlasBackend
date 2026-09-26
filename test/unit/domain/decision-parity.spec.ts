/**
 * @file AT-016 — paridad de decisiones: mismos hechos y mismo reloj, misma salida.
 * @business Separar la política de elegibilidad de la persistencia no puede cambiar ni una decisión;
 *   una «mejora» de la regla colada en un refactor es una regresión de negocio.
 * @system Las fixtures (`fixtures/eligibility-parity.json`) se generaron con la regla vigente el
 *   2026-09-11 en casos de frontera (documento que vence hoy, riesgo en el límite del TTL, 18 años
 *   cumplidos hoy…). La prueba compara la salida actual de `assess` con la registrada. Un cambio de
 *   regla intencional regenera las fixtures en su propia tarea, no aquí.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assess } from '../../../src/modules/customers/application/customer-eligibility.evaluator.js';
import { CustomerEligibilityService } from '../../../src/modules/customers/application/customer-eligibility.service.js';
import type { CustomerLifecycleStatus } from '../../../src/modules/customers/customer-lifecycle.constants.js';
import type { EligibilityFacts } from '../../../src/modules/customers/repositories/customer-eligibility.facts.js';
import { fixedClock } from '../../../src/platform/di/clock.js';

type Fixture = { now: string; cases: Record<string, { status: string; facts: EligibilityFacts; expected: ReturnType<typeof assess> }> };

const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/eligibility-parity.json'), 'utf8')) as Fixture;

/** Las fechas viajan como ISO en el JSON; la regla espera `Date` en `latestRisk.decidedAt`. */
function revive(facts: EligibilityFacts): EligibilityFacts {
  const risk = facts.latestRisk as unknown as { decidedAt?: string | null } | null;
  return risk?.decidedAt
    ? { ...facts, latestRisk: { ...risk, decidedAt: new Date(risk.decidedAt) } as unknown as EligibilityFacts['latestRisk'] }
    : facts;
}

describe('paridad de la regla de elegibilidad (AT-016)', () => {
  const now = new Date(fixture.now);

  it.each(Object.entries(fixture.cases))('%s: misma decisión, mismos bloqueadores, misma versión de regla', (_name, entry) => {
    const actual = assess(revive(entry.facts), entry.status as CustomerLifecycleStatus, now);
    expect(actual).toEqual(entry.expected);
  });

  it('cubre las fronteras temporales: documento que vence hoy sigue vigente, ayer no; riesgo en el TTL vale, un día después no', () => {
    expect(fixture.cases.documento_vence_hoy.expected.eligible).toBe(true);
    expect(fixture.cases.documento_vencio_ayer.expected.blockers.map((b) => b.code)).toContain('IDENTITY_DOCUMENT_EXPIRED');
    expect(fixture.cases.riesgo_en_el_limite_ttl.expected.eligible).toBe(true);
    expect(fixture.cases.riesgo_un_dia_pasado_el_ttl.expected.blockers.map((b) => b.code)).toContain('RISK_ASSESSMENT_STALE');
  });

  it('una regla o feature faltante no convierte un rechazo en aprobación (sin fallback nuevo)', () => {
    const facts = revive(fixture.cases.elegible.facts);
    expect(assess({ ...facts, latestRisk: null }, 'active', now).eligible).toBe(false);
    expect(assess({ ...facts, identityVerificationResult: null }, 'active', now).eligible).toBe(false);
  });

  it('el servicio evalúa con el reloj inyectado, no con la hora del sistema', async () => {
    const facts = revive(fixture.cases.documento_vencio_ayer.facts);
    const customersRepository = { findById: async () => ({ lifecycleStatus: 'active' }) };
    const eligibilityRepository = { loadFacts: async () => facts };
    // Con un reloj anterior al vencimiento, el mismo documento está vigente: la decisión depende del reloj.
    const service = new CustomerEligibilityService(
      customersRepository as never,
      eligibilityRepository as never,
      {} as never,
      {} as never,
      {} as never,
      fixedClock('2026-09-01T00:00:00.000Z'),
    );
    const assessment = await service.evaluate('t', 'c');
    expect(assessment.blockers.map((b) => b.code)).not.toContain('IDENTITY_DOCUMENT_EXPIRED');
  });
});
