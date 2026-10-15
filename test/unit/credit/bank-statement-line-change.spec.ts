/**
 * @file Lo que el extracto le hizo a la línea, y el extracto aplicado cuya línea retiene una persona.
 * @business «Subí mi extracto, ¿y qué cambió?»: antes la app sólo enseñaba la cuota medida, nunca la línea de
 *   antes y la de ahora ni la cuenta que las une. Y con el crédito sin autoaplicar, el extracto se quedaba
 *   «calculando» para siempre y el cliente no podía subir otro.
 * @system `toLineChange` / `calculationOf`, `BankStatementService.lineChange` y la rama retenida de `applyReview`.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { env } from '../../../src/config/env.js';
import { BankStatementService } from '../../../src/modules/credit/application/bank-statement.service.js';
import { calculationOf, toLineChange } from '../../../src/modules/credit/bank-statement-line-change.mapper.js';
import { toBankStatementResponse } from '../../../src/modules/credit/bank-statement.mapper.js';

function linea(over: Record<string, unknown> = {}) {
  return {
    id: '2',
    currencyCode: 'BOB',
    approvedLimit: '1275.00',
    recommendedLimit: '1500.00',
    riskBand: 'B',
    relationshipTier: 'NUEVO',
    capacityBinding: 'RELACION',
    supersedesCreditLineId: '1',
    capacityJson: {
      monthlyInstallment: 1500,
      recommendedLimit: 1500,
      bindingConstraint: 'RELACION',
      relationshipTier: 'NUEVO',
      ceilings: { byCapacity: 4500, byRelationship: 1500, byGraduation: 1800, product: 20000 },
    },
    ...over,
  } as never;
}

describe('calculationOf · la cuenta del recálculo, paso por paso', () => {
  it('reconstruye los cuatro pasos desde lo guardado con la línea', () => {
    expect(calculationOf(linea())).toEqual({
      monthlyInstallment: 1500,
      termMonths: 3,
      byCapacity: 4500,
      byRelationship: 1500,
      relationshipTier: 'NUEVO',
      byGraduation: 1800,
      productCeiling: 20000,
      recommendedLimit: 1500,
      bindingConstraint: 'RELACION',
      riskBand: 'B',
      approvedLimit: 1275,
    });
  });

  it('sin capacidad guardada no inventa la cuenta', () => {
    expect(calculationOf(linea({ capacityJson: null }))).toBeNull();
  });

  it('sin cuota medida no deduce un plazo', () => {
    const calculo = calculationOf(linea({ capacityJson: { ceilings: { byCapacity: null, byRelationship: 1500, product: 20000 } } }));
    expect(calculo?.termMonths).toBeNull();
    expect(calculo?.byCapacity).toBeNull();
  });
});

describe('toLineChange · antes y ahora', () => {
  it('con línea anterior, enseña las dos cifras', () => {
    expect(toLineChange(linea(), linea({ id: '1', approvedLimit: '900.00' }))).toMatchObject({
      previousLimit: 900,
      newLimit: 1275,
      currencyCode: 'BOB',
    });
  });

  it('la primera línea no tiene «antes»', () => {
    expect(toLineChange(linea({ supersedesCreditLineId: null }), null)?.previousLimit).toBeNull();
  });

  it('sin línea aplicada no hay cambio que enseñar', () => {
    expect(toLineChange(null, null)).toBeNull();
  });
});

describe('BankStatementService.lineChange', () => {
  function build(lineas: Record<string, unknown>) {
    const creditLines = { version: jest.fn(async (_t: string, _c: string, id: string) => lineas[id] ?? null) };
    const service = new BankStatementService({} as never, creditLines as never, {} as never, {} as never);
    return { service, creditLines };
  }

  it('busca la línea que abrió el extracto y la que sustituyó', async () => {
    const { service, creditLines } = build({ '2': linea(), '1': linea({ id: '1', approvedLimit: '900.00' }) });
    const cambio = await service.lineChange({ status: 'applied', appliedCreditLineId: '2', tenantId: '1', customerId: '10' } as never);
    expect(cambio).toMatchObject({ previousLimit: 900, newLimit: 1275 });
    expect(creditLines.version).toHaveBeenCalledWith('1', '10', '1');
  });

  it('un extracto en curso o retenido no consulta nada', async () => {
    const { service, creditLines } = build({});
    await expect(service.lineChange({ status: 'processing', appliedCreditLineId: null } as never)).resolves.toBeNull();
    await expect(service.lineChange({ status: 'applied', appliedCreditLineId: null } as never)).resolves.toBeNull();
    expect(creditLines.version).not.toHaveBeenCalled();
  });
});

describe('applyReview · la línea retenida para una persona ya no deja el extracto colgado', () => {
  const guardar = env.DECISION_ENGINE_AUTO_APPLY;
  afterEach(() => {
    (env as Record<string, unknown>).DECISION_ENGINE_AUTO_APPLY = guardar;
  });

  function build() {
    const review = {
      id: '7',
      tenantId: '1',
      customerId: '10',
      status: 'received',
      appliedCreditLineId: null,
      save: jest.fn(async () => undefined),
    };
    const reviews = { findOne: jest.fn(async (..._a: unknown[]) => review) };
    const creditLines = { recalculate: jest.fn(async (..._a: unknown[]) => null) };
    const service = new BankStatementService(reviews as never, creditLines as never, {} as never, {} as never);
    const run = {
      requestId: 'r1',
      status: 'SUCCEEDED',
      result: { affordability: { eligible: true, score: 70, capacity: { maxAffordableInstallment: 1500 } } },
    };
    return { service, review, run };
  }

  it('sin el crédito autoaplicado, se cierra como aplicado y sin línea', async () => {
    (env as Record<string, unknown>).DECISION_ENGINE_AUTO_APPLY = [];
    const { service, review, run } = build();
    await service.applyReview({ tenantId: '1', customerId: '10', reviewId: '7', run: run as never });
    expect(review.status).toBe('applied');
    expect(review.appliedCreditLineId).toBeNull();

    const respuesta = toBankStatementResponse(review as never);
    expect(respuesta.lineAwaitingApproval).toBe(true);
    expect(respuesta.statusLabel).toBe('Leímos tu extracto');
  });

  it('con el crédito autoaplicado, un motor que no respondió deja el extracto en curso para reintentar', async () => {
    (env as Record<string, unknown>).DECISION_ENGINE_AUTO_APPLY = ['credit'];
    const { service, review, run } = build();
    await service.applyReview({ tenantId: '1', customerId: '10', reviewId: '7', run: run as never });
    expect(review.status).toBe('processing');
    expect(toBankStatementResponse(review as never).lineAwaitingApproval).toBe(false);
  });
});
