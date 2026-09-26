import { reconcileJournal } from '../../../src/modules/qa-orchestration/domain/journal-reconciliation';
import {
  countersFrom,
  emptyPersonaTally,
  emptyStepTally,
  logicalOperationId,
  passRate,
  personaOutcome,
  personasBalance,
  runVerdict,
} from '../../../src/modules/qa-orchestration/domain/run-accounting';
import { CUSTOMER_CREDIT_JOURNEY } from '../../../src/modules/qa-orchestration/catalog/customer-credit.recipes';
import { COVERAGE_GAPS } from '../../../src/modules/qa-orchestration/catalog/coverage-gaps';
import { JOURNEY_TEMPLATES, coverageMatrix, endpointKey } from '../../../src/modules/qa-orchestration/catalog/journey-catalog';
import { FLUJO_CLIENTE_COMPLETO } from '../../../src/database/seeders/demo/flujo-cliente-completo.seed-data';
import { FLUJO_CLIENTE_PARTNER } from '../../../src/database/seeders/demo/flujo-cliente-partner.seed-data';

const executed = (stepKey: string, status = 'PASSED') => ({ personaKey: 'p-0001', stepKey, logicalOperationId: `op-${stepKey}`, status });
const call = (stepKey: string) => ({ type: 'responded', provider: 'SEGIP', personaKey: 'p-0001', logicalOperationId: `op-${stepKey}` });

describe('reconciliación con el journal del mock', () => {
  it('una previa que llamó al proveedor es una violación (A11)', () => {
    const result = reconcileJournal({
      template: CUSTOMER_CREDIT_JOURNEY,
      executed: [executed('credit.external_preview'), executed('credit.external_request')],
      journal: { entries: [call('credit.external_preview'), call('credit.external_request')], complete: true },
      namespaceOpened: true,
    });
    expect(result.mockConfirmed).toBe(false);
    expect(result.violations).toEqual([expect.objectContaining({ stepKey: 'credit.external_preview', expected: 'none', observed: 1 })]);
  });

  it('cero llamadas donde se esperaba mock invalida la evidencia (A10)', () => {
    const result = reconcileJournal({
      template: CUSTOMER_CREDIT_JOURNEY,
      executed: [executed('credit.external_request')],
      journal: { entries: [], complete: true },
      namespaceOpened: true,
    });
    expect(result.mockConfirmed).toBe(false);
  });

  it('un journal truncado no certifica aunque cuadre (A20)', () => {
    const result = reconcileJournal({
      template: CUSTOMER_CREDIT_JOURNEY,
      executed: [executed('credit.external_request')],
      journal: { entries: [call('credit.external_request')], complete: false },
      namespaceOpened: true,
    });
    expect(result.mockConfirmed).toBe(false);
    expect(result.detail).toMatch(/retención/);
  });

  it('llamada correlacionada, sin llamadas prohibidas y journal completo ⇒ confirmado', () => {
    const result = reconcileJournal({
      template: CUSTOMER_CREDIT_JOURNEY,
      executed: [executed('credit.external_preview'), executed('credit.external_request')],
      journal: { entries: [call('credit.external_request')], complete: true },
      namespaceOpened: true,
    });
    expect(result).toMatchObject({ mockConfirmed: true, providerCalls: 1, violations: [] });
  });

  it('sin namespace propio no hay evidencia, aunque el legacy haya visto tráfico', () => {
    expect(reconcileJournal({ template: CUSTOMER_CREDIT_JOURNEY, executed: [], journal: null, namespaceOpened: false }).mockConfirmed).toBe(
      false,
    );
  });
});

describe('contabilidad que no miente', () => {
  it('sin muestras no es 100 %', () => {
    expect(passRate(0, 0)).toBeNull();
    expect(passRate(3, 1)).toBe(0.75);
  });

  it('una persona fallida hace FAILED la corrida; indeterminadas sin fallos la dejan INCONCLUSIVE', () => {
    const base = { ...emptyPersonaTally(), PASSED: 19 };
    const counters = (extra: Partial<typeof base>) =>
      countersFrom({ personas: { ...base, ...extra }, steps: emptyStepTally(), requestsIssued: 0, personsRequested: 20 });
    expect(runVerdict(counters({ FAILED: 1 }), { externalEvidenceMissing: false })).toBe('FAILED');
    expect(runVerdict(counters({ INDETERMINATE: 1 }), { externalEvidenceMissing: false })).toBe('INCONCLUSIVE');
    expect(runVerdict(counters({ PASSED: 20 }), { externalEvidenceMissing: true })).toBe('INCONCLUSIVE');
    expect(runVerdict(counters({ PASSED: 20 }), { externalEvidenceMissing: false })).toBe('PASSED');
    expect(personasBalance(counters({ FAILED: 1 }))).toBe(true);
  });

  it('omitidos o no aplicables nunca hacen PASSED a una persona si algo falló antes', () => {
    expect(personaOutcome(['PASSED', 'FAILED', 'SKIPPED_DEPENDENCY'])).toBe('FAILED');
    expect(personaOutcome(['PASSED', 'NOT_APPLICABLE'])).toBe('PASSED');
    expect(personaOutcome(['NOT_APPLICABLE'])).toBe('BLOCKED');
  });

  it('el intento no entra en la operación lógica: un reintento conserva la clave (A12)', () => {
    const identity = { tenantId: '1', runId: '9', personaKey: 'p-0001', stepKey: 'signup.start', visitIndex: 0 };
    expect(logicalOperationId(identity)).toBe(logicalOperationId({ ...identity }));
    expect(logicalOperationId({ ...identity, visitIndex: 1 })).not.toBe(logicalOperationId(identity));
    expect(logicalOperationId({ ...identity, runId: '10' })).not.toBe(logicalOperationId(identity));
  });
});

describe('cobertura del inventario (121 pasos)', () => {
  const inventory = [FLUJO_CLIENTE_COMPLETO, FLUJO_CLIENTE_PARTNER].flatMap((flujo) =>
    flujo.stages.flatMap((stage) => stage.steps.map((step) => step.code)),
  );

  it('el inventario tiene 70 + 51 pasos', () => {
    expect(inventory).toHaveLength(121);
  });

  it('cada paso está cubierto por una receta o tiene un hueco con motivo; nunca las dos cosas', () => {
    const rows = coverageMatrix(inventory);
    const unclassified = rows.filter((row) => row.status === 'GAP' && !row.gapReason).map((row) => row.stepCode);
    const stale = rows.filter((row) => row.status === 'COVERED' && COVERAGE_GAPS[row.stepCode]).map((row) => row.stepCode);
    expect(unclassified).toEqual([]);
    expect(stale).toEqual([]);
    expect(Object.keys(COVERAGE_GAPS).filter((code) => !inventory.includes(code))).toEqual([]);
  });

  it('ninguna plantilla READY contiene marcadores por reemplazar ni IDs quemados', () => {
    for (const template of JOURNEY_TEMPLATES.filter((candidate) => candidate.status === 'READY')) {
      const text = JSON.stringify(template);
      expect(text).not.toMatch(/REEMPLAZA|Bearer |productId":"1"/);
    }
  });

  it('receta y catálogo casan por endpoint aunque escriban el parámetro distinto', () => {
    expect(endpointKey('POST', '/customers/{{resources.customerId}}/credit-applications')).toBe(
      endpointKey('post', '/customers/:customerId/credit-applications'),
    );
  });
});
