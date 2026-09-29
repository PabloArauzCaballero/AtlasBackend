import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { env } from '../../../src/config/env.js';
import { DecisionEngineArtifactsService } from '../../../src/modules/systems-ops/decision-engine-artifacts.service.js';

/**
 * «Qué política decide ahora mismo», tal como la ve el portal. Dos cosas que decía mal:
 * - la versión semántica salía de `latestVersion` del ARTEFACTO, que es la más nueva de cualquier
 *   estado (un borrador incluido), y no de la versión DESPLEGADA;
 * - pedía la primera página del motor (25) y con más la cuenta salía recortada sin decirlo.
 */
const mutable = env as unknown as Record<string, unknown>;
const original = { base: env.DECISION_ENGINE_BASE_URL };

function conMotor(artifacts: unknown[], deployments: unknown[]) {
  const urls: string[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
    urls.push(String(url));
    const items = String(url).includes('/v1/deployments') ? deployments : artifacts;
    return { ok: true, status: 200, json: async () => ({ items }) } as unknown as Response;
  });
  return urls;
}

const DESPLIEGUE = {
  id: '1',
  deploymentMode: 'FULL',
  deploymentStatus: 'ACTIVE',
  effectiveFrom: '2026-09-18T06:22:20.450Z',
  isActive: true,
  deployedBy: 'seed.system',
  deployedAt: '2026-09-18T06:22:20.450Z',
  environmentId: '1',
  artifactVersion: {
    id: '1',
    versionNumber: 1,
    semanticVersion: '1.2.0',
    validatedAt: null,
    status: 'COMPILED',
    artifact: { artifactCode: 'IDENTIDAD_CARNET_MOVIL', name: 'Identidad' },
  },
};

describe('DecisionEngineArtifactsService', () => {
  beforeEach(() => {
    mutable.DECISION_ENGINE_BASE_URL = 'https://motor.atlas.local';
  });
  afterEach(() => {
    mutable.DECISION_ENGINE_BASE_URL = original.base;
  });

  it('la versión semántica es la de la versión desplegada, no la última del artefacto', async () => {
    conMotor(
      // El artefacto ya tiene un borrador 1.3.0 encima de la 1.2.0 que decide.
      [
        {
          id: '1',
          artifactCode: 'IDENTIDAD_CARNET_MOVIL',
          name: 'Identidad',
          latestVersion: '1.3.0',
          latestStatus: 'DRAFT',
          lastValidatedAt: '2026-09-27T00:00:00.000Z',
        },
      ],
      [DESPLIEGUE],
    );

    const report = await new DecisionEngineArtifactsService().listActiveArtifacts('token');

    expect(report.status).toBe('OK');
    expect(report.items[0]).toMatchObject({ versionNumber: 1, semanticVersion: '1.2.0', versionStatus: 'COMPILED', lastValidatedAt: null });
  });

  it('pide al motor el tope de página en los dos listados', async () => {
    const urls = conMotor([], [DESPLIEGUE]);

    await new DecisionEngineArtifactsService().listActiveArtifacts('token');

    expect(urls.find((u) => u.includes('/v1/artifacts'))).toContain('pageSize=100');
    expect(urls.find((u) => u.includes('/v1/deployments'))).toContain('status=ACTIVE&pageSize=100');
  });
});
