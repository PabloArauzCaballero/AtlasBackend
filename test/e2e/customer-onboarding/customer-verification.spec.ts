import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CustomerVerificationController } from '../../../src/modules/customer-onboarding/customer-verification.controller.js';
import { CustomerVerificationService } from '../../../src/modules/customer-onboarding/application/customer-verification.service.js';
import { CustomerComplianceScreeningService } from '../../../src/modules/customer-onboarding/application/customer-compliance-screening.service.js';
import { authHeader, buildGenericTestApp, TENANT_HEADER } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de `CustomerVerificationController`: quién puede resolver identidad y cumplimiento
 * sobre el expediente de un cliente. Las tres rutas mutan el expediente en bloque (identidad,
 * documento, screening) y cada una exige un grupo de roles distinto — cumplimiento es más
 * restrictivo que el resto porque descarta hallazgos de listas restrictivas sin revisión posterior.
 */
describe('CustomerVerificationController (e2e/supertest)', () => {
  let app: INestApplication;

  const verificationService = {
    decideIdentity: jest.fn(async (..._args: unknown[]) => ({ eligible: false, blockers: [] })),
  };
  const screeningService = {
    screen: jest.fn(async (..._args: unknown[]) => ({ matches: [], eligible: false })),
    clearMatches: jest.fn(async (..._args: unknown[]) => ({ cleared: 1, eligible: true })),
  };

  beforeAll(async () => {
    app = await buildGenericTestApp(
      [CustomerVerificationController],
      [
        { provide: CustomerVerificationService, useValue: verificationService },
        { provide: CustomerComplianceScreeningService, useValue: screeningService },
      ],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST operations/customers/:customerId/identity-verification/decision', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/operations/customers/1/identity-verification/decision')
        .set(...TENANT_HEADER)
        .send({ decision: 'approve', reasonCode: 'ok' })
        .expect(401);
      expect(verificationService.decideIdentity).not.toHaveBeenCalled();
    });

    it('un cliente NO puede decidir su propia identidad', async () => {
      await request(app.getHttpServer())
        .post('/operations/customers/1/identity-verification/decision')
        .set(...authHeader('customer'))
        .set(...TENANT_HEADER)
        .send({ decision: 'approve', reasonCode: 'ok' })
        .expect(403);
      expect(verificationService.decideIdentity).not.toHaveBeenCalled();
    });

    it('un analista de riesgo aprueba y recibe 200', async () => {
      const response = await request(app.getHttpServer())
        .post('/operations/customers/1/identity-verification/decision')
        .set(...authHeader('risk_analyst'))
        .set(...TENANT_HEADER)
        .send({ decision: 'approve', reasonCode: 'documentos_validos' })
        .expect(200);

      expect(response.body).toMatchObject({ eligible: false });
      expect(verificationService.decideIdentity).toHaveBeenCalledTimes(1);
      const [[input]] = verificationService.decideIdentity.mock.calls as unknown as [[{ tenantId: string; customerId: string }]];
      expect(input.tenantId).toBe('1');
      expect(input.customerId).toBe('1');
    });

    it('rechazar sin nota se rechaza en el borde (400)', async () => {
      await request(app.getHttpServer())
        .post('/operations/customers/1/identity-verification/decision')
        .set(...authHeader('risk_analyst'))
        .set(...TENANT_HEADER)
        .send({ decision: 'reject', reasonCode: 'documento_alterado' })
        .expect(400);
      expect(verificationService.decideIdentity).not.toHaveBeenCalled();
    });
  });

  describe('POST operations/customers/:customerId/compliance/screening', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer()).post('/operations/customers/1/compliance/screening').set(...TENANT_HEADER).expect(401);
      expect(screeningService.screen).not.toHaveBeenCalled();
    });

    it('un cliente NO puede ejecutar el screening', async () => {
      await request(app.getHttpServer())
        .post('/operations/customers/1/compliance/screening')
        .set(...authHeader('customer'))
        .set(...TENANT_HEADER)
        .expect(403);
      expect(screeningService.screen).not.toHaveBeenCalled();
    });

    it('un analista de cumplimiento ejecuta el screening y recibe 200', async () => {
      await request(app.getHttpServer())
        .post('/operations/customers/1/compliance/screening')
        .set(...authHeader('compliance_analyst'))
        .set(...TENANT_HEADER)
        .expect(200);
      expect(screeningService.screen).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST operations/customers/:customerId/compliance/clear-matches', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/operations/customers/1/compliance/clear-matches')
        .set(...TENANT_HEADER)
        .send({ reasonCode: 'falso_positivo', notes: 'nombre coincidente, documento distinto' })
        .expect(401);
      expect(screeningService.clearMatches).not.toHaveBeenCalled();
    });

    it('un analista de RIESGO no puede descartar coincidencias — es exclusivo de cumplimiento/admin', async () => {
      // A diferencia de `screening` y `identity-verification/decision`, esta ruta excluye a
      // `risk_analyst`: descartar un hallazgo de lista restrictiva es una decisión de cumplimiento.
      await request(app.getHttpServer())
        .post('/operations/customers/1/compliance/clear-matches')
        .set(...authHeader('risk_analyst'))
        .set(...TENANT_HEADER)
        .send({ reasonCode: 'falso_positivo', notes: 'nombre coincidente, documento distinto' })
        .expect(403);
      expect(screeningService.clearMatches).not.toHaveBeenCalled();
    });

    it('sin nota se rechaza en el borde (400): descartar sin motivo escrito no es defendible', async () => {
      await request(app.getHttpServer())
        .post('/operations/customers/1/compliance/clear-matches')
        .set(...authHeader('compliance_analyst'))
        .set(...TENANT_HEADER)
        .send({ reasonCode: 'falso_positivo' })
        .expect(400);
      expect(screeningService.clearMatches).not.toHaveBeenCalled();
    });

    it('cumplimiento descarta las coincidencias y recibe 200', async () => {
      await request(app.getHttpServer())
        .post('/operations/customers/1/compliance/clear-matches')
        .set(...authHeader('compliance_analyst'))
        .set(...TENANT_HEADER)
        .send({ reasonCode: 'falso_positivo', notes: 'nombre coincidente, documento distinto' })
        .expect(200);
      expect(screeningService.clearMatches).toHaveBeenCalledTimes(1);
      const [[input]] = screeningService.clearMatches.mock.calls as unknown as [[{ reasonCode: string; notes: string }]];
      expect(input.reasonCode).toBe('falso_positivo');
    });
  });
});
