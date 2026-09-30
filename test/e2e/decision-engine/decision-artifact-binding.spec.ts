import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DecisionArtifactBindingController } from '../../../src/modules/decision-engine/decision-artifact-binding.controller.js';
import { DecisionArtifactBindingService } from '../../../src/modules/decision-engine/decision-artifact-binding.service.js';
import { authHeader, buildGenericTestApp, TENANT_HEADER } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de `POST /internal/decision-artifacts`: elige QUÉ ARTEFACTO decide identidad,
 * crédito y riesgo, y con qué versión fijada. El propio comentario del controlador narra que hasta
 * hace poco los guards faltaban del todo; esta suite fija ese contrato para que no se repita.
 * Señalada UNTESTED_WRITE: no había ningún test HTTP que nombrara esta ruta.
 *
 * Se prueba sólo el contrato HTTP (guard, rol, forma del cuerpo, delegación al servicio) — no la
 * lógica de gobierno real (las dos firmas humanas que exigen las reglas del proyecto para aprobar
 * versiones de artefactos viven en el portal del Motor, fuera de este controller).
 */
describe('DecisionArtifactBindingController (e2e/supertest) — POST /internal/decision-artifacts', () => {
  let app: INestApplication;

  const bindings = {
    list: jest.fn(async (..._args: unknown[]) => []),
    availableArtifacts: jest.fn(async (..._args: unknown[]) => []),
    assign: jest.fn(async (..._args: unknown[]) => ({
      decisionType: 'credit',
      artifactCode: 'credit-policy-v3',
      pinnedVersion: null,
    })),
  };

  beforeAll(async () => {
    app = await buildGenericTestApp([DecisionArtifactBindingController], [{ provide: DecisionArtifactBindingService, useValue: bindings }]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rechaza con 401 sin token', async () => {
    await request(app.getHttpServer())
      .post('/internal/decision-artifacts')
      .set(...TENANT_HEADER)
      .send({ decisionType: 'credit', artifactCode: 'credit-policy-v3' })
      .expect(401);
    expect(bindings.assign).not.toHaveBeenCalled();
  });

  it('rechaza con 403 a un rol ajeno al gobierno de riesgo (compliance_analyst, no está en la lista)', async () => {
    await request(app.getHttpServer())
      .post('/internal/decision-artifacts')
      .set(...authHeader('compliance_analyst'))
      .set(...TENANT_HEADER)
      .send({ decisionType: 'credit', artifactCode: 'credit-policy-v3' })
      .expect(403);
    expect(bindings.assign).not.toHaveBeenCalled();
  });

  it('un decisionType fuera del catálogo cerrado se rechaza con 400', async () => {
    await request(app.getHttpServer())
      .post('/internal/decision-artifacts')
      .set(...authHeader('risk_analyst'))
      .set(...TENANT_HEADER)
      .send({ decisionType: 'no-existe', artifactCode: 'credit-policy-v3' })
      .expect(400);
    expect(bindings.assign).not.toHaveBeenCalled();
  });

  it('un campo fuera del esquema (strict) se rechaza con 400', async () => {
    await request(app.getHttpServer())
      .post('/internal/decision-artifacts')
      .set(...authHeader('risk_analyst'))
      .set(...TENANT_HEADER)
      .send({ decisionType: 'credit', artifactCode: 'credit-policy-v3', extraField: true })
      .expect(400);
    expect(bindings.assign).not.toHaveBeenCalled();
  });

  it('un analista de riesgo asigna el artefacto y recibe 200', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/decision-artifacts')
      .set(...authHeader('risk_analyst', { internalUserId: 'iu-7' }))
      .set(...TENANT_HEADER)
      .send({ decisionType: 'credit', artifactCode: 'credit-policy-v3', notes: 'vuelta a la política conservadora' })
      .expect(200);

    expect(response.body).toEqual({ decisionType: 'credit', artifactCode: 'credit-policy-v3', pinnedVersion: null });
    expect(bindings.assign).toHaveBeenCalledWith({
      tenantId: '1',
      decisionType: 'credit',
      artifactCode: 'credit-policy-v3',
      pinnedVersion: null,
      internalUserId: 'iu-7',
      notes: 'vuelta a la política conservadora',
    });
  });
});
