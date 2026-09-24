import { evaluateQaStep, selectExpectation } from '../../../src/modules/qa-orchestration/domain/journey-assertions';
import { BindingUnresolvedError, referencedPaths, resolveBinding } from '../../../src/modules/qa-orchestration/domain/typed-bindings';

describe('oráculo de un paso QA', () => {
  it('no aprueba un HTTP 200 de otra persona (A02)', () => {
    const verdict = evaluateQaStep({
      expected: {
        status: [200],
        assertions: [{ kind: 'resourceOwner', path: 'data.customerId', expected: { $ref: 'resources.customerId' } }],
      },
      response: { status: 200, body: { data: { customerId: 'customer-B' } } },
      scope: { resources: { customerId: 'customer-A' } },
    });
    expect(verdict.status).toBe('FAILED');
    expect(verdict.failures).toContainEqual(expect.objectContaining({ code: 'OWNERSHIP_MISMATCH' }));
  });

  it('usa el catálogo equals sobre data.* sin raíz explícita', () => {
    const verdict = evaluateQaStep({
      expected: { status: [200], assertions: [{ kind: 'equals', path: 'data.customerId', expected: 'customer-A' }] },
      response: { status: 200, body: { data: { customerId: 'customer-B' } } },
    });
    expect(verdict.status).toBe('FAILED');
    expect(verdict.failures).toContainEqual(expect.objectContaining({ code: 'ASSERTION_EQUALS_FAILED' }));
  });

  it('aprueba un 400 esperado con su código de negocio exacto (A03)', () => {
    const verdict = evaluateQaStep({
      expected: { status: [400], assertions: [{ kind: 'errorCode', code: 'VALIDATION_ERROR' }] },
      response: { status: 400, body: { error: { code: 'VALIDATION_ERROR' } } },
    });
    expect(verdict.status).toBe('PASSED');
  });

  it('un 400 con otro código de negocio no aprueba', () => {
    const verdict = evaluateQaStep({
      expected: { status: [400], assertions: [{ kind: 'errorCode', code: 'VALIDATION_ERROR' }] },
      response: { status: 400, body: { error: { code: 'CUSTOMER_ALREADY_EXISTS' } } },
    });
    expect(verdict.status).toBe('FAILED');
  });

  it('un 2xx fuera del contrato de un rechazo esperado falla: la aprobación indebida no es éxito', () => {
    const verdict = evaluateQaStep({ expected: { status: [403, 422] }, response: { status: 201, body: { data: { applicationId: '9' } } } });
    expect(verdict.status).toBe('FAILED');
    expect(verdict.failures[0].code).toBe('STATUS_UNEXPECTED');
  });

  it('sin respuesta es INDETERMINATE, nunca FAILED ni PASSED', () => {
    const verdict = evaluateQaStep({ expected: { status: [200] }, response: { status: null, transportError: 'TIMEOUT' } });
    expect(verdict.status).toBe('INDETERMINATE');
  });

  it('una aserción que referencia algo ausente falla con BINDING_UNRESOLVED en vez de pasar', () => {
    const verdict = evaluateQaStep({
      expected: { status: [200], assertions: [{ kind: 'equals', path: 'data.x', expected: { $ref: 'resources.nope' } }] },
      response: { status: 200, body: { data: { x: 1 } } },
      scope: { resources: {} },
    });
    expect(verdict.failures[0].code).toBe('BINDING_UNRESOLVED');
  });

  it('elige la rama por el estado previo al envío', () => {
    const chosen = selectExpectation(
      { status: [403] },
      [{ label: 'elegible', when: { kind: 'equals', path: 'resources.eligible', value: true }, status: [201] }],
      { resources: { eligible: true } },
    );
    expect(chosen.status).toEqual([201]);
    expect(selectExpectation({ status: [403] }, undefined, {}).label).toBe('default');
  });

  it('arrayContainsWhere encuentra el recurso persistido', () => {
    const ok = evaluateQaStep({
      expected: {
        status: [200],
        assertions: [{ kind: 'arrayContainsWhere', path: 'data.applications', field: 'id', expected: { $ref: 'resources.applicationId' } }],
      },
      response: { status: 200, body: { data: { applications: [{ id: '7' }] } } },
      scope: { resources: { applicationId: '7' } },
    });
    expect(ok.status).toBe('PASSED');
  });
});

describe('bindings tipados (A06)', () => {
  const scope = {
    persona: { monthlyIncome: 4500, email: 'a@example.test' },
    fixtures: { consents: [{ id: '1', granted: true }] },
    resources: { flag: false },
  };

  it('conserva números, arrays y booleanos', () => {
    const body = resolveBinding(
      { income: { $ref: 'persona.monthlyIncome' }, consents: { $ref: 'fixtures.consents' }, flag: { $ref: 'resources.flag' } },
      scope,
    );
    expect(body).toEqual({ income: 4500, consents: [{ id: '1', granted: true }], flag: false });
  });

  it('interpola sólo dentro de cadenas', () => {
    expect(resolveBinding('/c/{{persona.email}}/x', scope)).toBe('/c/a@example.test/x');
  });

  it('un marcador ausente bloquea antes del envío', () => {
    expect(() => resolveBinding({ id: '{{resources.customerId}}' }, scope)).toThrow(BindingUnresolvedError);
    expect(() => resolveBinding({ $ref: 'resources.customerId' }, scope)).toThrow('BINDING_UNRESOLVED:resources.customerId');
  });

  it('un objeto dentro de una cadena es un error de receta, no "[object Object]"', () => {
    expect(() => resolveBinding('x-{{fixtures.consents}}', scope)).toThrow(BindingUnresolvedError);
  });

  it('lista las rutas que un binding necesita', () => {
    expect(referencedPaths({ a: { $ref: 'persona.email' }, b: ['{{resources.id}}'] })).toEqual(['persona.email', 'resources.id']);
  });
});

describe('aserción absent', () => {
  it('distingue un campo ausente de uno que vino con null', () => {
    const expected = { status: [200], assertions: [{ kind: 'absent' as const, path: 'data.providerVerdict' }] };
    expect(evaluateQaStep({ expected, response: { status: 200, body: { data: {} } } }).status).toBe('PASSED');
    expect(evaluateQaStep({ expected, response: { status: 200, body: { data: { providerVerdict: 'FOUND' } } } }).failures[0].code).toBe(
      'ASSERTION_ABSENT_FAILED',
    );
  });
});
