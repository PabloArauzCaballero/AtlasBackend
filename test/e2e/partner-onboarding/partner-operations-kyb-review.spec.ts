import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PartnerOperationsController } from '../../../src/modules/partner-onboarding/partner-operations.controller.js';
import { PartnerProfileService } from '../../../src/modules/partner-onboarding/application/partner-profile.service.js';
import { PartnerQrReviewService } from '../../../src/modules/partner-onboarding/application/partner-qr-review.service.js';
import { PartnerVerificationService } from '../../../src/modules/partner-onboarding/application/partner-verification.service.js';
import { InternalPermissionsGuard } from '../../../src/modules/internal-users/guards/internal-permissions.guard.js';
import { InternalRbacRepository } from '../../../src/modules/internal-users/internal-rbac.repository.js';
import { INTERNAL_PERMISSIONS_CHECKER } from '../../../src/common/guards/internal-permissions.port.js';
import { authHeader, buildGenericTestApp, TENANT_HEADER } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de `POST operations/partners/:partnerId/kyb-review`.
 *
 * No se autoriza por `@Roles` de método (la clase ya exige un rol interno) sino por
 * `@InternalPermissions('partner.kyb.request')`, resuelto por `InternalPermissionsGuard` contra
 * `internal_rbac` — el mismo catálogo cuya falta de sincronización dejó `partner.qr.review` sin
 * nadie que pudiera usarlo (memoria `atlas-backend-gates-en-rojo`). Esta suite simula el
 * repositorio RBAC real: concede el permiso a un usuario y se lo niega a otro, ambos con el MISMO
 * rol de aplicación (`internal_operator`), para demostrar que la puerta es el permiso y no el rol.
 */
describe('PartnerOperationsController — kyb-review (e2e/supertest)', () => {
  let app: INestApplication;

  const profiles = {
    requireProfile: jest.fn(async (..._args: unknown[]) => ({ legalName: 'X', tradeName: 'X', onboardingStatus: 'under_review' })),
  };
  const qr = { listPendingReview: jest.fn(async () => []), review: jest.fn(async () => ({})) };
  const verification = {
    listAwaitingDecision: jest.fn(async () => ({ items: [] })),
    findByExternalKeys: jest.fn(async () => ({ items: [] })),
    linkErpAccount: jest.fn(async () => ({})),
    requestKybReview: jest.fn(async (..._args: unknown[]) => ({
      profile: { id: '10', legalName: 'Comercio X', onboardingStatus: 'approved' },
      decision: 'APROBADO',
    })),
  };

  // El permiso se concede por usuario interno: `usuario-con-permiso` lo tiene, `usuario-sin-permiso` no.
  const rbacRepository = {
    hasPermissions: jest.fn(
      async (_tenantId: string, internalUserId: string, _permissions: string[]) => internalUserId === 'usuario-con-permiso',
    ),
  };

  beforeAll(async () => {
    app = await buildGenericTestApp(
      [PartnerOperationsController],
      [
        { provide: PartnerProfileService, useValue: profiles },
        { provide: PartnerQrReviewService, useValue: qr },
        { provide: PartnerVerificationService, useValue: verification },
        InternalPermissionsGuard,
        { provide: InternalRbacRepository, useValue: rbacRepository },
        { provide: INTERNAL_PERMISSIONS_CHECKER, useExisting: InternalRbacRepository },
      ],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('rechaza con 401 sin token', async () => {
    await request(app.getHttpServer())
      .post('/operations/partners/10/kyb-review')
      .set(...TENANT_HEADER)
      .send({})
      .expect(401);
    expect(verification.requestKybReview).not.toHaveBeenCalled();
  });

  it('un merchant NO puede pedir la revisión — la clase exige rol interno', async () => {
    await request(app.getHttpServer())
      .post('/operations/partners/10/kyb-review')
      .set(...authHeader('merchant'))
      .set(...TENANT_HEADER)
      .send({})
      .expect(403);
    expect(verification.requestKybReview).not.toHaveBeenCalled();
  });

  it('un internal_operator SIN el permiso partner.kyb.request recibe 403 y no llama al servicio', async () => {
    await request(app.getHttpServer())
      .post('/operations/partners/10/kyb-review')
      .set(...authHeader('internal_operator', { internalUserId: 'usuario-sin-permiso', tenantId: '1' }))
      .set(...TENANT_HEADER)
      .send({})
      .expect(403);
    expect(verification.requestKybReview).not.toHaveBeenCalled();
    expect(rbacRepository.hasPermissions).toHaveBeenCalledWith('1', 'usuario-sin-permiso', ['partner.kyb.request']);
  });

  it('un internal_operator CON el permiso partner.kyb.request pide la revisión y recibe 200', async () => {
    const response = await request(app.getHttpServer())
      .post('/operations/partners/10/kyb-review')
      .set(...authHeader('internal_operator', { internalUserId: 'usuario-con-permiso', tenantId: '1' }))
      .set(...TENANT_HEADER)
      .send({ reason: 'expediente completo' })
      .expect(200);

    expect(response.body).toMatchObject({ decision: 'APROBADO' });
    expect(verification.requestKybReview).toHaveBeenCalledTimes(1);
    const [[tenantId, partnerId]] = verification.requestKybReview.mock.calls as unknown as [[string, string]];
    expect(tenantId).toBe('1');
    expect(partnerId).toBe('10');
  });
});
