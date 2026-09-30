import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { OperationsController } from '../../../src/modules/operations/operations.controller.js';
import { OperationsService } from '../../../src/modules/operations/operations.service.js';
import { FraudService } from '../../../src/modules/fraud/fraud.service.js';
import { PendingContactVerificationService } from '../../../src/modules/operations/pending-contact-verification.service.js';
import { OnboardingBehaviorSummaryService } from '../../../src/modules/customer-telemetry/application/onboarding-behavior-summary.service.js';
import { authHeader, buildGenericTestApp, IDEMPOTENCY_HEADER, TENANT_HEADER } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de las dos decisiones de la cola de operaciones:
 *  - `POST operations/manual-review-cases/:caseId/decision`
 *  - `POST operations/fraud-cases/:caseId/decision`
 *
 * Los roles del método afilan los de la clase: la clase deja pasar a
 * `internal_operator/risk_analyst/compliance_analyst/admin/platform_admin`, pero cada `@Post`
 * declara su propio `@Roles` más estricto. `test/unit/operations/operations.controller.spec.ts`
 * ya cubre el caso de uso llamando al controlador directo; esto añade el borde HTTP real: guards
 * montados, cabecera de idempotencia exigida por el propio método, y el 400 antes del servicio.
 */
describe('OperationsController (e2e/supertest) — decisiones', () => {
  let app: INestApplication;

  const operationsService = {
    decideManualReviewCase: jest.fn(async (..._args: unknown[]) => ({ caseId: '3', status: 'resolved' })),
    getWorkQueue: jest.fn(),
    getManualReviewCasesCursorPage: jest.fn(),
    getFraudCasesCursorPage: jest.fn(),
    getInvestigationSummary: jest.fn(),
  };
  const fraudService = {
    decideFraudCase: jest.fn(async (..._args: unknown[]) => ({ caseId: '4', status: 'resolved' })),
  };
  const pendingContacts = { list: jest.fn() };
  const comportamiento = { calcular: jest.fn(), ultimo: jest.fn() };

  beforeAll(async () => {
    app = await buildGenericTestApp(
      [OperationsController],
      [
        { provide: OperationsService, useValue: operationsService },
        { provide: FraudService, useValue: fraudService },
        { provide: PendingContactVerificationService, useValue: pendingContacts },
        { provide: OnboardingBehaviorSummaryService, useValue: comportamiento },
      ],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST operations/manual-review-cases/:caseId/decision', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/operations/manual-review-cases/3/decision')
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .send({ decision: 'approved', reasonCode: 'ok' })
        .expect(401);
      expect(operationsService.decideManualReviewCase).not.toHaveBeenCalled();
    });

    it('compliance_analyst NO puede decidir (el método restringe a operator/risk/admin/platform_admin)', async () => {
      // La clase admite a `compliance_analyst`, pero este método en concreto lo excluye: es más
      // estricto que el nivel de clase, justo el caso que un test sólo de clase no detectaría.
      await request(app.getHttpServer())
        .post('/operations/manual-review-cases/3/decision')
        .set(...authHeader('compliance_analyst'))
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .send({ decision: 'approved', reasonCode: 'ok' })
        .expect(403);
      expect(operationsService.decideManualReviewCase).not.toHaveBeenCalled();
    });

    it('sin x-idempotency-key se rechaza antes del servicio', async () => {
      await request(app.getHttpServer())
        .post('/operations/manual-review-cases/3/decision')
        .set(...authHeader('internal_operator'))
        .set(...TENANT_HEADER)
        .send({ decision: 'approved', reasonCode: 'ok' })
        .expect(400);
      expect(operationsService.decideManualReviewCase).not.toHaveBeenCalled();
    });

    it('un operador interno decide y recibe 200', async () => {
      const response = await request(app.getHttpServer())
        .post('/operations/manual-review-cases/3/decision')
        .set(...authHeader('internal_operator'))
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .send({ decision: 'approved', reasonCode: 'ok' })
        .expect(200);

      expect(response.body).toMatchObject({ caseId: '3' });
      const [[input]] = operationsService.decideManualReviewCase.mock.calls as unknown as [
        [{ tenantId: string; idempotencyKey: string; params: { caseId: string } }],
      ];
      expect(input.tenantId).toBe('1');
      expect(input.idempotencyKey).toBe('idem-e2e-generic-1');
      expect(input.params.caseId).toBe('3');
    });
  });

  describe('POST operations/fraud-cases/:caseId/decision', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/operations/fraud-cases/4/decision')
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .send({ decision: 'false_positive' })
        .expect(401);
      expect(fraudService.decideFraudCase).not.toHaveBeenCalled();
    });

    it('internal_operator NO puede decidir fraude: es exclusivo de fraud_analyst/admin/platform_admin', async () => {
      await request(app.getHttpServer())
        .post('/operations/fraud-cases/4/decision')
        .set(...authHeader('internal_operator'))
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .send({ decision: 'false_positive' })
        .expect(403);
      expect(fraudService.decideFraudCase).not.toHaveBeenCalled();
    });

    it('sin x-idempotency-key se rechaza antes del servicio', async () => {
      await request(app.getHttpServer())
        .post('/operations/fraud-cases/4/decision')
        .set(...authHeader('fraud_analyst'))
        .set(...TENANT_HEADER)
        .send({ decision: 'false_positive' })
        .expect(400);
      expect(fraudService.decideFraudCase).not.toHaveBeenCalled();
    });

    it('un analista de fraude decide y recibe 200', async () => {
      const response = await request(app.getHttpServer())
        .post('/operations/fraud-cases/4/decision')
        .set(...authHeader('fraud_analyst'))
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .send({ decision: 'confirmed_fraud', reasonCode: 'watchlist', applyWatchlist: true })
        .expect(200);

      expect(response.body).toMatchObject({ caseId: '4' });
      const [[input]] = fraudService.decideFraudCase.mock.calls as unknown as [
        [{ tenantId: string; idempotencyKey: string; params: { caseId: string } }],
      ];
      expect(input.tenantId).toBe('1');
      expect(input.idempotencyKey).toBe('idem-e2e-generic-1');
      expect(input.params.caseId).toBe('4');
    });
  });
});
