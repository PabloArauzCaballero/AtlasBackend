import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { ForbiddenException, NotFoundException, UnprocessableEntityException, BadRequestException } from '@nestjs/common';
import { RiskService } from '../../../src/modules/risk/risk.service.js';
import { AuthenticatedUser } from '../../../src/common/types/auth.types.js';
import { CreateRiskAssessmentDto } from '../../../src/modules/risk/risk.schemas.js';

/**
 * ATLAS-P10-020 (cierra parcialmente RC-03 de AUDITORIA_ATLAS_BACKEND_10_10.md para `risk`):
 * `risk.service.ts` decide, con reglas explícitas y auditables, si un cliente avanza en
 * onboarding o pasa a revisión manual — es exactamente el tipo de lógica que
 * `BACKEND_DEVELOPMENT_CONTEXT.md` §12 exige mantener versionada y auditable, y que
 * `PROMPT_MASTER_ATLAS.md` prohíbe tratar como caja negra. No tenía ningún test propio antes de
 * este flujo.
 *
 * Se mockea `RiskRepository` y `CustomersRepository` por completo (no hay Postgres real en el
 * test unitario) y `sequelize.transaction` se resuelve invocando
 * directamente el callback — foco en la LÓGICA DE DECISIÓN (scores, reason codes, resultado),
 * no en el mapeo objeto-relacional, que es responsabilidad de un test de integración contra una
 * base de datos real (ver ATLAS-P10-001..005, Fase 0 de AUDITORIA_ATLAS_BACKEND_10_10.md).
 */

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `id-${idCounter}`;
}

function buildRiskRepositoryMock() {
  return {
    findLatestCustomerRiskResult: jest.fn(),
    findCustomerConsents: jest.fn(async () => [{ granted: true, revokedAt: null }]),
    findCustomerContacts: jest.fn(async () => [{ status: 'verified' }]),
    findIdentityDocuments: jest.fn(async () => [{ id: 'doc-1' }]),
    createFeatureComputationRun: jest.fn(async () => ({ id: nextId() })),
    createFeatureValue: jest.fn(async () => ({ id: nextId() })),
    createFeatureSnapshot: jest.fn(async () => ({ id: nextId() })),
    createRiskAssessmentRun: jest.fn(async () => ({ id: nextId() })),
    attachSnapshotToRun: jest.fn(async () => undefined),
    createRiskAssessmentContext: jest.fn(async () => ({ id: nextId() })),
    createRuleFired: jest.fn(async () => ({ id: nextId() })),
    createContribution: jest.fn(async () => ({ id: nextId() })),
    createRiskResult: jest.fn(async () => ({ id: nextId() })),
    createManualReviewCase: jest.fn(async () => ({ id: nextId() })),
    createDataQualityIssue: jest.fn(async () => ({ id: nextId() })),
    createAudit: jest.fn(async () => ({ id: nextId() })),
    findRiskRun: jest.fn(),
    findRiskResultByRun: jest.fn(),
    findRulesByRun: jest.fn(async () => []),
    findContributionsByRun: jest.fn(async () => []),
    findSnapshotByRun: jest.fn(),
  };
}

function buildCustomersRepositoryMock(customer: { lifecycleStatus: string } | null = { lifecycleStatus: 'active' }) {
  return { findById: jest.fn(async () => customer) };
}

function buildSequelizeMock() {
  return { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
}

function buildUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { sub: 'customer-1', role: 'customer', customerId: 'customer-1', tenantId: 'tenant-1', ...overrides };
}

function buildBody(overrides: Partial<CreateRiskAssessmentDto> = {}): CreateRiskAssessmentDto {
  return {
    assessmentType: 'onboarding_initial',
    channel: 'mobile_app',
    sessionId: undefined,
    deviceId: undefined,
    requestedLimitContext: undefined,
    ...overrides,
  } as CreateRiskAssessmentDto;
}

describe('RiskService.getLatestCustomerRiskResult', () => {
  it('rechaza con ForbiddenException si un cliente pide datos de otro cliente', async () => {
    const riskRepository = buildRiskRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const service = new RiskService(riskRepository as never, customersRepository as never, buildSequelizeMock() as never);

    await expect(
      service.getLatestCustomerRiskResult({ tenantId: 't1', customerId: 'other-customer', currentUser: buildUser() }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lanza NotFoundException si el cliente no existe', async () => {
    const riskRepository = buildRiskRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock(null);
    const service = new RiskService(riskRepository as never, customersRepository as never, buildSequelizeMock() as never);

    await expect(
      service.getLatestCustomerRiskResult({ tenantId: 't1', customerId: 'customer-1', currentUser: buildUser() }),
    ).rejects.toThrow(NotFoundException);
  });

  it('devuelve null si el cliente existe pero no tiene evaluación de riesgo previa', async () => {
    const riskRepository = buildRiskRepositoryMock();
    riskRepository.findLatestCustomerRiskResult.mockResolvedValueOnce(null);
    const customersRepository = buildCustomersRepositoryMock();
    const service = new RiskService(riskRepository as never, customersRepository as never, buildSequelizeMock() as never);

    const result = await service.getLatestCustomerRiskResult({ tenantId: 't1', customerId: 'customer-1', currentUser: buildUser() });

    expect(result).toBeNull();
  });
});

describe('RiskService.createRiskAssessment — reglas de decisión', () => {
  beforeEach(() => {
    idCounter = 0;
  });

  it('exige X-Idempotency-Key: sin él, lanza BadRequestException antes de tocar ningún repositorio', async () => {
    const riskRepository = buildRiskRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const service = new RiskService(riskRepository as never, customersRepository as never, buildSequelizeMock() as never);

    await expect(
      service.createRiskAssessment({
        tenantId: 't1',
        customerId: 'customer-1',
        body: buildBody(),
        currentUser: buildUser(),
        idempotencyKey: '',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(customersRepository.findById).not.toHaveBeenCalled();
  });

  it('bloquea la evaluación si el cliente está en estado blocked', async () => {
    const riskRepository = buildRiskRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock({ lifecycleStatus: 'blocked' });
    const service = new RiskService(riskRepository as never, customersRepository as never, buildSequelizeMock() as never);

    await expect(
      service.createRiskAssessment({
        tenantId: 't1',
        customerId: 'customer-1',
        body: buildBody(),
        currentUser: buildUser(),
        idempotencyKey: 'idem-1',
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('exige consentimiento vigente: sin consentimiento otorgado (o revocado), rechaza con REQUIRED_CONSENT_MISSING', async () => {
    const riskRepository = buildRiskRepositoryMock();
    riskRepository.findCustomerConsents.mockResolvedValueOnce([{ granted: true, revokedAt: new Date() }]); // revocado
    const customersRepository = buildCustomersRepositoryMock();
    const service = new RiskService(riskRepository as never, customersRepository as never, buildSequelizeMock() as never);

    await expect(
      service.createRiskAssessment({
        tenantId: 't1',
        customerId: 'customer-1',
        body: buildBody(),
        currentUser: buildUser(),
        idempotencyKey: 'idem-1',
      }),
    ).rejects.toThrow('REQUIRED_CONSENT_MISSING');
  });

  it('caso feliz: identidad + contacto verificado + consentimiento → approved_for_next_step, riskLevel alto, sin caso de revisión manual', async () => {
    const riskRepository = buildRiskRepositoryMock(); // identidad + contacto verificado por defecto
    const customersRepository = buildCustomersRepositoryMock();
    const service = new RiskService(riskRepository as never, customersRepository as never, buildSequelizeMock() as never);

    const result = await service.createRiskAssessment({
      tenantId: 't1',
      customerId: 'customer-1',
      body: buildBody({ deviceId: 'device-1' }),
      currentUser: buildUser(),
      idempotencyKey: 'idem-1',
    });

    // identityScore=70, contactScore=90, deviceScore=70 (deviceId presente), behaviorScore=50,
    // consistencyScore=75, fraudScore=20 → total = round((70+90+70+50+75+80)/6) = round(72.5) = 73
    expect(result.decision).toBe('approved_for_next_step');
    expect(result.riskLevel).toBe('medium'); // 73 está en [55,75) → medium
    expect(result.manualReviewCaseId).toBeNull();
    expect(result.nextStep).toBe('continue_onboarding');
    expect(result.fraudRiskLevel).toBe('low'); // fraudScore=20 < 40
    expect(riskRepository.createManualReviewCase).not.toHaveBeenCalled();
    expect(riskRepository.createDataQualityIssue).not.toHaveBeenCalled();
    // Auditoría siempre debe registrarse, resuelva lo que resuelva la decisión.
    expect(riskRepository.createAudit).toHaveBeenCalledTimes(1);
  });

  it('sin identidad ni contacto verificado → manual_review_required, crea caso de revisión y 2 issues de calidad de datos', async () => {
    const riskRepository = buildRiskRepositoryMock();
    riskRepository.findIdentityDocuments.mockResolvedValueOnce([]); // sin identidad
    riskRepository.findCustomerContacts.mockResolvedValueOnce([{ status: 'pending' }]); // sin contacto verificado
    const customersRepository = buildCustomersRepositoryMock();
    const service = new RiskService(riskRepository as never, customersRepository as never, buildSequelizeMock() as never);

    const result = await service.createRiskAssessment({
      tenantId: 't1',
      customerId: 'customer-1',
      body: buildBody(),
      currentUser: buildUser(),
      idempotencyKey: 'idem-1',
    });

    expect(result.decision).toBe('manual_review_required');
    expect(result.nextStep).toBe('manual_review');
    expect(result.manualReviewCaseId).not.toBeNull();
    expect(result.reasons.map((r) => r.code)).toEqual(['missing_identity_document', 'missing_verified_contact']);
    expect(riskRepository.createManualReviewCase).toHaveBeenCalledTimes(1);
    expect(riskRepository.createDataQualityIssue).toHaveBeenCalledTimes(2); // uno por cada dato faltante
  });

  it('permite que un rol interno (no customer) evalúe el riesgo de cualquier cliente', async () => {
    const riskRepository = buildRiskRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const service = new RiskService(riskRepository as never, customersRepository as never, buildSequelizeMock() as never);

    await expect(
      service.createRiskAssessment({
        tenantId: 't1',
        customerId: 'customer-999',
        body: buildBody(),
        currentUser: buildUser({ role: 'risk_analyst', customerId: undefined, internalUserId: 'analyst-1' }),
        idempotencyKey: 'idem-1',
      }),
    ).resolves.toMatchObject({ decision: 'approved_for_next_step' });
  });

  it('un cliente no puede disparar una evaluación de riesgo para otro cliente', async () => {
    const riskRepository = buildRiskRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const service = new RiskService(riskRepository as never, customersRepository as never, buildSequelizeMock() as never);

    await expect(
      service.createRiskAssessment({
        tenantId: 't1',
        customerId: 'otro-customer',
        body: buildBody(),
        currentUser: buildUser({ customerId: 'customer-1' }),
        idempotencyKey: 'idem-1',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('la integrityHash del resultado depende de runId+decision+totalScore (determinístico y auditable)', async () => {
    const riskRepository = buildRiskRepositoryMock();
    const customersRepository = buildCustomersRepositoryMock();
    const service = new RiskService(riskRepository as never, customersRepository as never, buildSequelizeMock() as never);

    await service.createRiskAssessment({
      tenantId: 't1',
      customerId: 'customer-1',
      body: buildBody({ deviceId: 'device-1' }),
      currentUser: buildUser(),
      idempotencyKey: 'idem-1',
    });

    expect(riskRepository.createRiskResult).toHaveBeenCalledTimes(1);
    const createRiskResultArgs = riskRepository.createRiskResult.mock.calls[0][0] as { integrityHash: string; recommendedAction: string };
    expect(createRiskResultArgs.integrityHash).toEqual(expect.any(String));
    expect(createRiskResultArgs.integrityHash.length).toBeGreaterThan(0);
  });
});

describe('RiskService.getRiskAssessmentExplanation', () => {
  it('lanza NotFoundException si la corrida de riesgo no existe', async () => {
    const riskRepository = buildRiskRepositoryMock();
    riskRepository.findRiskRun.mockResolvedValueOnce(null);
    const customersRepository = buildCustomersRepositoryMock();
    const service = new RiskService(riskRepository as never, customersRepository as never, buildSequelizeMock() as never);

    await expect(service.getRiskAssessmentExplanation('t1', 'run-404')).rejects.toThrow(NotFoundException);
  });

  it('separa factores positivos (score>=60) de negativos (score<60) y arma el resumen con las reglas disparadas', async () => {
    const riskRepository = buildRiskRepositoryMock();
    riskRepository.findRiskRun.mockResolvedValueOnce({ id: 'run-1' });
    riskRepository.findRiskResultByRun.mockResolvedValueOnce({ recommendedAction: 'approved_for_next_step' });
    riskRepository.findRulesByRun.mockResolvedValueOnce([{ reasonCode: 'minimum_onboarding_risk_passed' }]);
    riskRepository.findContributionsByRun.mockResolvedValueOnce([
      { featureCode: 'identity', reasonCode: 'positive_readiness', scorePoints: '80.00' },
      { featureCode: 'device', reasonCode: 'new_device', scorePoints: '40.00' },
    ]);
    const customersRepository = buildCustomersRepositoryMock();
    const service = new RiskService(riskRepository as never, customersRepository as never, buildSequelizeMock() as never);

    const explanation = await service.getRiskAssessmentExplanation('t1', 'run-1');

    expect(explanation.decision).toBe('approved_for_next_step');
    expect(explanation.topPositiveFactors).toHaveLength(1);
    expect(explanation.topPositiveFactors[0]).toMatchObject({ code: 'identity', impact: 'positive' });
    expect(explanation.topNegativeFactors).toHaveLength(1);
    expect(explanation.topNegativeFactors[0]).toMatchObject({ code: 'device', impact: 'negative' });
    expect(explanation.summary).toContain('minimum_onboarding_risk_passed');
  });
});
