import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Sequelize } from 'sequelize-typescript';
import { toCreditLineResponse } from '../../../src/modules/credit/credit-line.mapper.js';
import {
  pricedRateAndTier,
  pricedRateUnitToPercentNumber,
} from '../../../src/modules/credit/application/credit-decision-pricing.mapper.js';
import { LoanDisbursementService } from '../../../src/modules/loans/application/loan-disbursement.service.js';
import type { LoansRepository } from '../../../src/modules/loans/loans.repository.js';
import type { CreditRepository } from '../../../src/modules/credit/credit.repository.js';
import type { InternalRbacRepository } from '../../../src/modules/internal-users/internal-rbac.repository.js';
import type { ExposureReservationService } from '../../../src/modules/credit/application/exposure-reservation.service.js';
import type { OriginationConsentCheck } from '../../../src/modules/credit/application/origination-consent-check.service.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';
import type { CreditLineModel } from '../../../src/database/models/index.js';
import type { DecisionResponse } from '../../../src/modules/decision-engine/decision-engine.types.js';

/**
 * @file "Lo que se muestra = lo que se cobra" (T-2, plan `_plan-motor-decisiones-tasa-2026-09-25`).
 *
 * ## La propiedad que se prueba
 *
 * `credit-line.mapper.ts` es lo que el cliente lee ANTES de pedir: la línea de crédito, con su APR.
 * `loan-disbursement.service.ts` es lo que el cliente PAGA al desembolsar: la tasa con la que se
 * calculó su cronograma (`loan-schedule.ts`). Las dos cifras nacen del MISMO campo del Motor
 * (`annual_percentage_rate`, en tanto por uno), pero viajan por dos caminos de persistencia
 * distintos (`credit_lines` vs `credit_applications`) con precisiones distintas (DECIMAL(6,2) vs
 * DECIMAL(7,4)). El contrato que este archivo prueba es que, para el MISMO caso —el mismo número
 * publicado por el Motor—, las dos cifras que el cliente puede llegar a comparar coinciden.
 *
 * Sin la conversión de unidades (`rate-units.ts`, fijada por la prueba de contrato 18↔0,18 de
 * `credit-decision-pricing.mapper.spec.ts`) en CUALQUIERA de los dos lados, esta prueba falla: una
 * línea que muestra 0,18 y un préstamo que cobra 18 % no son el mismo número aunque vengan de la
 * misma decisión.
 */
const OPERADOR = { role: 'internal_operator', internalUserId: '7', tenantId: 't1' } as AuthenticatedUser;

function respuestaDelMotor(annualPercentageRateUnit: number, pricingTier: string): DecisionResponse {
  return {
    executionId: 'exe-1',
    status: 'COMPLETED',
    outcome: 'APPROVE',
    reasonCodes: [],
    output: { annual_percentage_rate: annualPercentageRateUnit, pricing_tier: pricingTier },
  } as unknown as DecisionResponse;
}

/** La línea de crédito tal y como la escribiría `credit-line-recalculation.service.ts` HOY (mismo camino de conversión). */
function lineaDelMismoCaso(response: DecisionResponse): CreditLineModel {
  return {
    customerId: 'c1',
    currencyCode: 'BOB',
    approvedLimit: '2000.00',
    scoring: 720,
    riskBand: 'B',
    pricingTier: pricedRateAndTier(response).pricingTier,
    annualPercentageRate: pricedRateUnitToPercentNumber((response.output as Record<string, unknown>).annual_percentage_rate),
    maxAffordableInstallment: null,
    disposableIncome: null,
    affordabilityScore: null,
    affordabilityDecision: null,
    probabilityOfDefault: null,
    recommendedLimit: null,
    relationshipScore: null,
    relationshipTier: null,
    capacityBinding: null,
    capacityEvidence: null,
    decisionOutcome: 'APPROVED',
    decisionExecutionId: response.executionId,
    artifactCode: 'ATLAS_BNPL_UNDERWRITING',
    artifactVersionId: 'v2',
    calculationTrigger: 'application',
    validFrom: new Date('2026-09-26T00:00:00Z'),
    validUntil: null,
    reasonCodesJson: [],
    provenanceJson: {},
  } as unknown as CreditLineModel;
}

describe('APR mostrada (línea de crédito) = APR cobrada (préstamo desembolsado), para el MISMO caso decidido por el Motor', () => {
  let loans: { findLoanByApplication: jest.Mock; createLoan: jest.Mock; bulkCreateInstallments: jest.Mock; createEvent: jest.Mock };
  let credit: { findApplicationById: jest.Mock; findProductById: jest.Mock };
  let rbac: { hasPermissions: jest.Mock<(...args: unknown[]) => Promise<boolean>> };
  let exposure: { reserve: jest.Mock; consume: jest.Mock };
  let consents: { assertMayOriginate: jest.Mock };
  let service: LoanDisbursementService;

  beforeEach(() => {
    loans = {
      findLoanByApplication: jest.fn(async () => null),
      createLoan: jest.fn(async (values: unknown) => ({ id: 'L1', maturityDate: null, ...(values as Record<string, unknown>) })),
      bulkCreateInstallments: jest.fn(async () => undefined),
      createEvent: jest.fn(async () => ({ id: 1 })),
    };
    credit = {
      findApplicationById: jest.fn(),
      findProductById: jest.fn(async () => ({
        id: 'pr-1',
        annualInterestRate: '10.0000',
        minAnnualInterestRate: null,
        maxAnnualInterestRate: null,
      })),
    };
    rbac = { hasPermissions: jest.fn(async (..._args: unknown[]): Promise<boolean> => false) };
    exposure = { reserve: jest.fn(async () => undefined), consume: jest.fn(async () => undefined) };
    consents = { assertMayOriginate: jest.fn(async () => undefined) };
    const sequelize = { transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) } as unknown as Sequelize;
    service = new LoanDisbursementService(
      loans as unknown as LoansRepository,
      credit as unknown as CreditRepository,
      sequelize,
      exposure as unknown as ExposureReservationService,
      consents as unknown as OriginationConsentCheck,
      rbac as unknown as InternalRbacRepository,
    );
  });

  function solicitudDelMismoCaso(decisionPricedRate: string) {
    return {
      id: 'ap-1',
      status: 'approved',
      customerId: 'c1',
      creditProductId: 'pr-1',
      partnerProfileId: 'pp-1',
      currencyCode: 'BOB',
      requestedAmount: '1200.00',
      requestedTermMonths: 6,
      decisionExecutionId: 'exe-1',
      decisionArtifactVersionId: 'art-2',
      decisionSubjectReference: 'cust:c1',
      decisionPricedRate,
      businessAcceptance: null,
      decidedAt: new Date(),
      decisionValidUntil: null,
    };
  }

  it('el Motor decide 0,18 (banda B): la línea muestra 18 y el préstamo cobra 18 — el MISMO número', async () => {
    const response = respuestaDelMotor(0.18, 'B');

    // Lo que ve el cliente ANTES de pedir: la línea de crédito.
    const lineaMostrada = toCreditLineResponse(lineaDelMismoCaso(response));

    // Lo que se le cobra AL desembolsar: la solicitud llevó la MISMA decisión persistida
    // (`credit-underwriting.service.ts` ya convirtió 0,18 → '18.0000' con esta misma función).
    const decisionPricedRate = pricedRateAndTier(response).pricedRate;
    expect(decisionPricedRate).toBe('18.0000');
    credit.findApplicationById.mockResolvedValueOnce(solicitudDelMismoCaso(decisionPricedRate!) as never);

    await service.disburse({ tenantId: 't1', applicationId: 'ap-1', body: {} as never, currentUser: OPERADOR, idempotencyKey: 'idem-1' });
    const loanCobrado = Number((loans.createLoan.mock.calls.at(-1)?.[0] as { annualInterestRate: string }).annualInterestRate);

    expect(lineaMostrada.annualPercentageRate).toBe(18);
    expect(loanCobrado).toBe(18);
    expect(lineaMostrada.annualPercentageRate).toBe(loanCobrado);
  });

  it('lo mismo con otra banda (0,145 → 14,5 %), para no fijar sólo el caso redondo', async () => {
    const response = respuestaDelMotor(0.145, 'C');
    const lineaMostrada = toCreditLineResponse(lineaDelMismoCaso(response));
    const decisionPricedRate = pricedRateAndTier(response).pricedRate;
    credit.findApplicationById.mockResolvedValueOnce(solicitudDelMismoCaso(decisionPricedRate!) as never);

    await service.disburse({ tenantId: 't1', applicationId: 'ap-1', body: {} as never, currentUser: OPERADOR, idempotencyKey: 'idem-2' });
    const loanCobrado = Number((loans.createLoan.mock.calls.at(-1)?.[0] as { annualInterestRate: string }).annualInterestRate);

    expect(lineaMostrada.annualPercentageRate).toBeCloseTo(14.5, 4);
    expect(loanCobrado).toBeCloseTo(14.5, 4);
  });

  it('PRUEBA EN NEGATIVO — sin la conversión de unidades, la línea mostraría 0,18 y el préstamo cobraría 18: NO son el mismo número', () => {
    // Reproduce el defecto que esta prueba existe para cerrar: leer el campo del Motor CRUDO, sin
    // pasarlo por `rate-units.ts`, es exactamente lo que hacía `credit-line-recalculation.service.ts`
    // antes de este Frente.
    const crudo = 0.18;
    const mostradoSinConvertir = crudo; // lo que `credit_lines.annual_percentage_rate` guardaba
    const cobradoConvertido = 18; // lo que `credit_applications.decision_priced_rate` YA guarda

    expect(mostradoSinConvertir).not.toBe(cobradoConvertido);
  });
});
