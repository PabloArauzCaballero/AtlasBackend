import { describe, expect, it, jest } from '@jest/globals';
import { WorkflowTransitionService } from '../../../src/modules/workflow-catalog/application/workflow-transition.service.js';
import { buildBundle } from './workflow-bundle.fixtures.js';
import type { WorkflowBundle } from '../../../src/modules/workflow-catalog/workflow-catalog.repository.js';

function buildService(bundle: WorkflowBundle = buildBundle()) {
  const catalogService = { loadBundle: jest.fn(async () => bundle) };
  return { service: new WorkflowTransitionService(catalogService as never), bundle };
}

const BASE = { version: 'latest' as const, completedStepCodes: [] as string[] };

describe('WorkflowTransitionService.validate', () => {
  it('acepta una transición declarada cuyas precondiciones se cumplen', async () => {
    const { service } = buildService();

    const result = await service.validate('demo_flow', { ...BASE, fromStepCode: 'step.one', toStepCode: 'step.two' } as never);

    expect(result).toMatchObject({ allowed: true, reasonCode: 'TRANSITION_DECLARED' });
    expect(result.transition?.transitionCode).toBe('one_to_two');
  });

  it('acepta una entrada al flujo cuando se pregunta sin paso de origen', async () => {
    const { service } = buildService();

    const result = await service.validate('demo_flow', { ...BASE, toStepCode: 'step.one' } as never);

    expect(result).toMatchObject({ allowed: true, fromStepCode: null });
    expect(result.transition?.transitionCode).toBe('entry');
  });

  it('rechaza como no declarada una entrada por un paso que no es entrada del flujo', async () => {
    const { service } = buildService();

    const result = await service.validate('demo_flow', { ...BASE, toStepCode: 'step.two' } as never);

    expect(result).toMatchObject({ allowed: false, reasonCode: 'TRANSITION_NOT_DECLARED' });
  });

  it('responde STEP_NOT_FOUND si alguno de los pasos no existe en la versión', async () => {
    const { service } = buildService();

    await expect(service.validate('demo_flow', { ...BASE, toStepCode: 'inexistente' } as never)).resolves.toMatchObject({
      allowed: false,
      reasonCode: 'STEP_NOT_FOUND',
    });
    await expect(
      service.validate('demo_flow', { ...BASE, fromStepCode: 'inexistente', toStepCode: 'step.two' } as never),
    ).resolves.toMatchObject({ reasonCode: 'STEP_NOT_FOUND' });
  });

  it('bloquea con UNSATISFIED_DEPENDENCIES y nombra los pasos previos que faltan', async () => {
    const { service } = buildService();

    const result = await service.validate('demo_flow', { ...BASE, fromStepCode: 'step.two', toStepCode: 'step.three' } as never);

    expect(result).toMatchObject({ allowed: false, reasonCode: 'UNSATISFIED_DEPENDENCIES', unsatisfiedDependencies: ['step.two'] });
  });

  it('acepta la transición cuando las dependencias obligatorias ya se completaron', async () => {
    const { service } = buildService();

    const result = await service.validate('demo_flow', {
      ...BASE,
      fromStepCode: 'step.two',
      toStepCode: 'step.three',
      completedStepCodes: ['step.two'],
      role: 'internal_operator',
      lifecycleStatus: 'under_review',
    } as never);

    expect(result).toMatchObject({ allowed: true, reasonCode: 'TRANSITION_DECLARED' });
  });

  it('no bloquea por dependencias informativas (requires_data / soft)', async () => {
    const bundle = buildBundle();
    bundle.dependencies[0] = { ...bundle.dependencies[0], dependencyType: 'requires_data' } as never;
    const { service } = buildService(bundle);

    const result = await service.validate('demo_flow', {
      ...BASE,
      fromStepCode: 'step.two',
      toStepCode: 'step.three',
      role: 'internal_operator',
    } as never);

    expect(result.allowed).toBe(true);
  });

  it('rechaza el rol no autorizado en el paso destino', async () => {
    const { service } = buildService();

    const result = await service.validate('demo_flow', {
      ...BASE,
      fromStepCode: 'step.two',
      toStepCode: 'step.three',
      completedStepCodes: ['step.two'],
      role: 'customer',
    } as never);

    expect(result).toMatchObject({ allowed: false, reasonCode: 'ROLE_NOT_AUTHORIZED' });
  });

  it('permite cualquier rol en un paso que no declara roles', async () => {
    const { service } = buildService();

    const result = await service.validate('demo_flow', { ...BASE, toStepCode: 'step.one', role: 'devops' } as never);

    expect(result.allowed).toBe(true);
  });

  it('rechaza el estado del ciclo de vida que el paso destino no admite', async () => {
    const { service } = buildService();

    const result = await service.validate('demo_flow', {
      ...BASE,
      fromStepCode: 'step.two',
      toStepCode: 'step.three',
      completedStepCodes: ['step.two'],
      role: 'internal_operator',
      lifecycleStatus: 'registered',
    } as never);

    expect(result).toMatchObject({ allowed: false, reasonCode: 'STATE_NOT_ALLOWED', requiredStates: ['under_review'] });
  });

  it('evalúa las dependencias antes que el rol: faltar un paso previo es el impedimento más básico', async () => {
    const { service } = buildService();

    const result = await service.validate('demo_flow', {
      ...BASE,
      fromStepCode: 'step.two',
      toStepCode: 'step.three',
      role: 'customer',
    } as never);

    expect(result.reasonCode).toBe('UNSATISFIED_DEPENDENCIES');
  });
});
