/**
 * @file La ruta de operaciones del expediente del alta: sólo roles internos y el mismo JSON que va al Motor.
 * @business Un cliente no puede leer el expediente de revisión (lleva criterio interno); el equipo interno sí.
 * @system Ejercita `OnboardingReviewDossierController` y sus metadatos de roles.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { ROLES_KEY } from '../../../src/common/decorators/roles.decorator.js';
import { OnboardingReviewDossierController } from '../../../src/modules/customer-onboarding/onboarding-review-dossier.controller.js';

describe('OnboardingReviewDossierController', () => {
  it('GET /operations/customers/:id/review-dossier delega en el servicio con inquilino y cliente', async () => {
    const dossiers = { build: jest.fn(async (..._args: unknown[]) => ({ version: 1 })) };
    const controller = new OnboardingReviewDossierController(dossiers as never);

    await expect(controller.get('t1', { customerId: '42' } as never)).resolves.toEqual({ version: 1 });
    expect(dossiers.build).toHaveBeenCalledWith('t1', '42');
  });

  it('sólo roles internos: el cliente no está entre ellos', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, OnboardingReviewDossierController.prototype.get) as string[];
    expect(roles).toEqual(expect.arrayContaining(['internal_operator', 'risk_analyst', 'admin', 'platform_admin']));
    expect(roles).not.toContain('customer');
  });
});
