import { describe, expect, it } from '@jest/globals';
import { SegipAdapter } from '../../../src/modules/external-data/infrastructure/adapters/segip/segip.adapter.js';

/**
 * `SegipAdapter` (identidad SEGIP). En modo `local` genera payloads por escenario (sin HTTP), en
 * disabled/production/sandbox lanza, y `normalize` deriva las observaciones de identidad. Plantilla
 * de test común a los adapters de external-data.
 */
describe('SegipAdapter', () => {
  const adapter = new SegipAdapter();
  const local = (scenario?: string) => ({ mode: 'local', providerCode: 'SEGIP', input: scenario ? { scenario } : {} }) as never;

  it('execute lanza en disabled y en producción/sandbox no configurado', async () => {
    await expect(adapter.execute({ mode: 'disabled', input: {} } as never)).rejects.toThrow('SEGIP_PROVIDER_DISABLED');
    await expect(adapter.execute({ mode: 'production', input: {} } as never)).rejects.toThrow('SEGIP_REAL_INTEGRATION_NOT_CONFIGURED');
    await expect(adapter.execute({ mode: 'sandbox', input: {} } as never)).rejects.toThrow('SEGIP_REAL_INTEGRATION_NOT_CONFIGURED');
  });

  it('execute (local) devuelve el payload del escenario, con happy_path por defecto', async () => {
    const notFound = await adapter.execute(local('not_found'));
    expect(notFound).toMatchObject({ providerCode: 'SEGIP', status: 'NOT_FOUND', isMocked: true });
    expect((notFound.payload as { documentExists: boolean }).documentExists).toBe(false);

    const happy = await adapter.execute(local());
    expect(happy.status).toBe('FOUND');
    expect((happy.payload as { matchScore: number }).matchScore).toBe(0.98);
  });

  it('normalize deriva 5 observaciones; verified/manualReview según status y score', async () => {
    const found = await adapter.normalize({
      status: 'FOUND',
      payload: { status: 'FOUND', documentExists: true, birthDateMatches: true, matchScore: 0.98 },
    } as never);
    expect(found).toHaveLength(5);
    const docExists = found.find((o) => o.observationKey === 'identity_document_exists');
    expect(docExists).toMatchObject({ valueBoolean: true, verified: true, manualReviewRequired: false });
    const score = found.find((o) => o.observationKey === 'identity_name_match_score');
    expect(score).toMatchObject({ valueNumber: 0.98, verified: true });

    const partial = await adapter.normalize({ status: 'PARTIAL_MATCH', payload: { status: 'PARTIAL_MATCH', matchScore: 0.62 } } as never);
    // status PARTIAL_MATCH => manualReview true (derivado) y verified false en el documento
    expect(partial.find((o) => o.observationKey === 'identity_manual_review_required')).toMatchObject({ valueBoolean: true });
    expect(partial.find((o) => o.observationKey === 'identity_document_exists')).toMatchObject({ verified: false });
  });

  it('checkHealth delega en checkMockHealth (disabled -> DOWN)', async () => {
    expect(await adapter.checkHealth('disabled' as never)).toMatchObject({ providerCode: 'SEGIP', status: 'DOWN' });
  });
});
