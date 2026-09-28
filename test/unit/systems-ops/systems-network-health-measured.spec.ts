import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { env } from '../../../src/config/env.js';
import { manifestConfigFor } from '../../../src/modules/systems-ops/platform-blocks.constants.js';
import { SystemsNetworkHealthService } from '../../../src/modules/systems-ops/systems-network-health.service.js';

/**
 * «Endpoints 0» en la tarjeta de Atlas Backend era un cero que nadie había medido. El reporte de
 * red tiene que decir si sus contadores son una medición, y el propio backend no puede declararse
 * «se introspecciona solo» mientras no conste que lo hizo.
 */
function build(states: Array<{ systemCode: string; lastStatus: string; lastSuccessAt: Date | null }>) {
  const health = { getToolsHealth: jest.fn(async () => []) };
  const federation = {
    countsByBlock: jest.fn(async () => ({ endpoints: new Map<string, number>(), dataEntities: new Map([['ATLAS_BACKEND', 220]]) })),
    listStates: jest.fn(async () =>
      states.map((state) => ({ lastMessage: null, lastAttemptAt: null, remoteVersion: null, remoteCommit: null, ...state })),
    ),
  };
  return new SystemsNetworkHealthService(health as never, federation as never);
}

describe('SystemsNetworkHealthService · ¿es una medición?', () => {
  it('sin constancia de ninguna lectura, nada está medido y el propio backend figura como NEVER_RUN', async () => {
    const report = await build([]).getNetworkHealth();

    const self = report.blocks.find((block) => block.systemCode === 'ATLAS_BACKEND');
    expect(self?.catalog).toMatchObject({ endpoints: 0, measured: false, federationStatus: 'NEVER_RUN' });
    for (const block of report.blocks) expect(block.catalog.measured).toBe(false);
  });

  it('con una lectura correcta, el propio backend es SELF_INTROSPECTED y su cero pasa a ser un dato', async () => {
    const report = await build([{ systemCode: 'ATLAS_BACKEND', lastStatus: 'OK', lastSuccessAt: new Date() }]).getNetworkHealth();

    const self = report.blocks.find((block) => block.systemCode === 'ATLAS_BACKEND');
    expect(self?.catalog).toMatchObject({ measured: true, federationStatus: 'SELF_INTROSPECTED' });
  });

  it('un bloque que funcionó y luego falló conserva que SÍ se midió alguna vez', async () => {
    const report = await build([{ systemCode: 'ERP_BACKEND', lastStatus: 'UNREACHABLE', lastSuccessAt: new Date() }]).getNetworkHealth();

    const erp = report.blocks.find((block) => block.systemCode === 'ERP_BACKEND');
    expect(erp?.catalog).toMatchObject({ measured: true, federationStatus: 'UNREACHABLE' });
  });
});

describe('manifestConfigFor · el motor sin persona detrás', () => {
  const mutableEnv = env as unknown as Record<string, unknown>;
  const original = {
    DECISION_ENGINE_GOVERNANCE_API_KEY: env.DECISION_ENGINE_GOVERNANCE_API_KEY,
    DECISION_ENGINE_OUTCOME_API_KEY: env.DECISION_ENGINE_OUTCOME_API_KEY,
    DECISION_ENGINE_TENANT_ID: env.DECISION_ENGINE_TENANT_ID,
  };
  afterEach(() => {
    Object.assign(mutableEnv, original);
  });

  it('con sesión reenvía la identidad de la persona y no manda llave', () => {
    Object.assign(mutableEnv, { DECISION_ENGINE_GOVERNANCE_API_KEY: 'llave-de-gestion' });
    const config = manifestConfigFor('DECISION_ENGINE', 'token-de-persona');
    expect(config).toMatchObject({ authHeader: 'authorization', authValue: 'Bearer token-de-persona' });
    expect(config?.extraHeaders).toBeUndefined();
  });

  it('sin sesión usa la llave del plano de gestión y el tenant del motor', () => {
    Object.assign(mutableEnv, { DECISION_ENGINE_GOVERNANCE_API_KEY: 'llave-de-gestion', DECISION_ENGINE_TENANT_ID: '7' });
    const config = manifestConfigFor('DECISION_ENGINE', null);
    expect(config).toMatchObject({ authHeader: 'x-api-key', authValue: 'llave-de-gestion', extraHeaders: { 'x-tenant-id': '7' } });
  });

  it('sin llave de gobierno cae a la de desenlaces, que también es de gestión', () => {
    Object.assign(mutableEnv, { DECISION_ENGINE_GOVERNANCE_API_KEY: undefined, DECISION_ENGINE_OUTCOME_API_KEY: 'llave-de-desenlaces' });
    expect(manifestConfigFor('DECISION_ENGINE', null)?.authValue).toBe('llave-de-desenlaces');
  });

  it('sin sesión ni llave no hay credencial, y el motivo lo dice', () => {
    Object.assign(mutableEnv, { DECISION_ENGINE_GOVERNANCE_API_KEY: undefined, DECISION_ENGINE_OUTCOME_API_KEY: undefined });
    const config = manifestConfigFor('DECISION_ENGINE', null);
    expect(config?.authValue).toBeUndefined();
    expect(config?.missingCredentialReason).toMatch(/DECISION_ENGINE_GOVERNANCE_API_KEY/);
  });
});
