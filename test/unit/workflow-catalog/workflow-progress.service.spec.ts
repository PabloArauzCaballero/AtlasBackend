import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import type { EligibilityAssessment } from '../../../src/modules/customers/application/customer-eligibility.evaluator.js';
import { WorkflowProgressService } from '../../../src/modules/workflow-catalog/application/workflow-progress.service.js';
import { buildBundle, buildStage, buildStep } from './workflow-bundle.fixtures.js';
import type { WorkflowBundle } from '../../../src/modules/workflow-catalog/workflow-catalog.repository.js';

function assessment(overrides: Partial<EligibilityAssessment> = {}): EligibilityAssessment {
  return {
    eligible: false,
    lifecycleStatus: 'onboarding_in_progress',
    ruleVersion: 'eligibility-v1',
    sections: [
      { code: 'contact_verification', status: 'completed', missingFields: [] },
      { code: 'address', status: 'pending', missingFields: ['address'] },
    ],
    completionPercentage: 50,
    canSubmit: false,
    nextStep: 'address',
    blockers: [{ code: 'ADDRESS_MISSING' }],
    ...overrides,
  } as EligibilityAssessment;
}

/** Bundle con reglas de completitud reales: una cumplida, una pendiente y una manual. */
function progressBundle(): WorkflowBundle {
  const bundle = buildBundle();
  bundle.stages = [
    buildStage({
      id: '10',
      stageCode: 'contact',
      displayOrder: 10,
      completionRule: { type: 'onboarding_section', sectionCode: 'contact_verification' },
    }),
    buildStage({
      id: '11',
      stageCode: 'address',
      displayOrder: 20,
      completionRule: { type: 'onboarding_section', sectionCode: 'address' },
    }),
    buildStage({ id: '12', stageCode: 'review', displayOrder: 30, completionRule: { type: 'manual' }, actorType: 'internal_user' }),
  ];
  bundle.steps = [
    buildStep({ id: '100', stepCode: 'contact.submit', workflowStageId: '10', executionOrder: 10 }),
    buildStep({
      id: '101',
      stepCode: 'address.optional',
      workflowStageId: '11',
      executionOrder: 10,
      isMandatory: false,
      routePath: '/customer-onboarding/:customerId/documents/upload-url',
      httpMethod: 'POST',
    }),
    buildStep({
      id: '102',
      stepCode: 'address.package',
      workflowStageId: '11',
      executionOrder: 20,
      httpMethod: 'POST',
      routePath: '/customer-onboarding/:customerId/address-package',
      allowedRoles: ['customer'],
    }),
    buildStep({ id: '103', stepCode: 'review.decide', workflowStageId: '12', executionOrder: 10 }),
  ];
  bundle.dependencies = [];
  bundle.transitions = [];
  return bundle;
}

function buildService(overrides: { bundle?: WorkflowBundle; assessment?: EligibilityAssessment } = {}) {
  const catalogService = { loadBundle: jest.fn(async (..._args: unknown[]) => overrides.bundle ?? progressBundle()) };
  const eligibilityService = { evaluate: jest.fn(async (..._args: unknown[]) => overrides.assessment ?? assessment()) };
  return {
    service: new WorkflowProgressService(catalogService as never, eligibilityService as never),
    catalogService,
    eligibilityService,
  };
}

const CUSTOMER = { role: 'customer', customerId: '5', sub: '5' } as never;
const OPERATOR = { role: 'internal_operator', sub: 'op-1' } as never;
const QUERY = { version: 'latest' as const };

describe('WorkflowProgressService.getProgress', () => {
  it('impide que un cliente consulte el avance de otro', async () => {
    const { service } = buildService();

    await expect(
      service.getProgress({ tenantId: '1', customerId: '9', currentUser: CUSTOMER, query: QUERY as never }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('permite a un rol operacional interno consultar cualquier cliente', async () => {
    const { service } = buildService();

    const result = await service.getProgress({ tenantId: '1', customerId: '9', currentUser: OPERATOR, query: QUERY as never });

    expect(result.customerId).toBe('9');
  });

  it('usa el flujo estándar cuando no se indica ninguno', async () => {
    const { service, catalogService } = buildService();

    await service.getProgress({ tenantId: '1', customerId: '5', currentUser: CUSTOMER, query: QUERY as never });

    expect(catalogService.loadBundle).toHaveBeenCalledWith('customer_credit_journey', 'latest');
  });

  it('evalúa la habilitación SIN persistir: consultar el avance es una lectura', async () => {
    const { service, eligibilityService } = buildService();

    await service.getProgress({ tenantId: '1', customerId: '5', currentUser: CUSTOMER, query: QUERY as never });

    expect(eligibilityService.evaluate).toHaveBeenCalledWith('1', '5');
  });

  it('clasifica las etapas en completadas, actual, pendientes y no aplicables', async () => {
    const { service } = buildService();

    const result = await service.getProgress({ tenantId: '1', customerId: '5', currentUser: CUSTOMER, query: QUERY as never });

    expect(result.completedStageCodes).toEqual(['contact']);
    expect(result.currentStageCode).toBe('address');
    // La etapa actual va incluida en lo pendiente y en su posición del recorrido, no al principio.
    expect(result.pendingStageCodes).toEqual(['address']);
    expect(result.stages.find((stage) => stage.stageCode === 'review')?.status).toBe('not_applicable');
  });

  it('devuelve como siguiente paso el primer paso OBLIGATORIO de la etapa actual', async () => {
    const { service } = buildService();

    const result = await service.getProgress({ tenantId: '1', customerId: '5', currentUser: CUSTOMER, query: QUERY as never });

    // `address.optional` tiene menor `executionOrder` pero no es obligatorio: proponerlo mandaría al
    // cliente a una llamada que no lo hace avanzar.
    expect(result.nextStep).toEqual({
      stageCode: 'address',
      stepCode: 'address.package',
      httpMethod: 'POST',
      routePath: '/customer-onboarding/:customerId/address-package',
      allowedRoles: ['customer'],
    });
  });

  it('no propone siguiente paso cuando no queda ninguna etapa pendiente', async () => {
    const { service } = buildService({
      assessment: assessment({
        lifecycleStatus: 'active',
        eligible: true,
        completionPercentage: 100,
        blockers: [],
        sections: [
          { code: 'contact_verification', status: 'completed', missingFields: [] },
          { code: 'address', status: 'completed', missingFields: [] },
        ],
      }),
    });

    const result = await service.getProgress({ tenantId: '1', customerId: '5', currentUser: CUSTOMER, query: QUERY as never });

    expect(result.currentStageCode).toBeNull();
    expect(result.nextStep).toBeNull();
    expect(result.completedStageCodes).toEqual(['contact', 'address']);
  });

  it('marca todas las etapas como bloqueadas cuando el cliente está bloqueado', async () => {
    const { service } = buildService({ assessment: assessment({ lifecycleStatus: 'blocked' }) });

    const result = await service.getProgress({ tenantId: '1', customerId: '5', currentUser: CUSTOMER, query: QUERY as never });

    expect(result.blockedStageCodes).toEqual(['contact', 'address', 'review']);
    expect(result.nextStep).toBeNull();
  });

  it('propaga los bloqueadores y el porcentaje de la evaluación sin recalcularlos', async () => {
    const { service } = buildService();

    const result = await service.getProgress({ tenantId: '1', customerId: '5', currentUser: CUSTOMER, query: QUERY as never });

    expect(result.completionPercentage).toBe(50);
    expect(result.blockers).toEqual([{ code: 'ADDRESS_MISSING' }]);
    expect(result.lifecycleStatus).toBe('onboarding_in_progress');
  });

  it('no señala como actual a una etapa contenedora: el foco va a la subetapa concreta', async () => {
    const bundle = progressBundle();
    // `captura` es un contenedor pendiente por definición mientras su subetapa `address` lo esté.
    bundle.stages = [
      bundle.stages[0],
      buildStage({
        id: '20',
        stageCode: 'captura',
        displayOrder: 15,
        completionRule: { type: 'no_blockers', blockerCodes: ['ADDRESS_MISSING'] },
      }),
      { ...bundle.stages[1], parentStageId: '20', displayOrder: 10 } as never,
      bundle.stages[2],
    ];
    const { service } = buildService({ bundle });

    const result = await service.getProgress({ tenantId: '1', customerId: '5', currentUser: CUSTOMER, query: QUERY as never });

    expect(result.currentStageCode).toBe('address');
    expect(result.stages.find((stage) => stage.stageCode === 'captura')?.status).toBe('pending');
    // El contenedor sigue apareciendo en lo pendiente, antes de la subetapa que lo mantiene abierto.
    expect(result.pendingStageCodes).toEqual(['captura', 'address']);
  });

  it('devuelve las etapas en orden de recorrido del árbol, no por display_order plano', async () => {
    const bundle = progressBundle();
    bundle.stages = [
      bundle.stages[0],
      buildStage({ id: '20', stageCode: 'captura', displayOrder: 15, completionRule: { type: 'manual' } }),
      { ...bundle.stages[1], parentStageId: '20', displayOrder: 10 } as never,
      bundle.stages[2],
    ];
    const { service } = buildService({ bundle });

    const result = await service.getProgress({ tenantId: '1', customerId: '5', currentUser: CUSTOMER, query: QUERY as never });

    // `address` tiene display_order 10 igual que `contact`: un sort plano lo pondría primero.
    expect(result.stages.map((stage) => stage.stageCode)).toEqual(['contact', 'captura', 'address', 'review']);
  });

  it('cada paso hereda el estado de su etapa', async () => {
    const { service } = buildService();

    const result = await service.getProgress({ tenantId: '1', customerId: '5', currentUser: CUSTOMER, query: QUERY as never });

    const addressStage = result.stages.find((stage) => stage.stageCode === 'address');
    expect(addressStage?.steps.map((step) => step.status)).toEqual(['current', 'current']);
  });
});
