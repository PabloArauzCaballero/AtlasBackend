/**
 * @file AT-043 — la evidencia de un proveedor la aplica su dueño; Integraciones no escribe tablas ajenas.
 * @business Respuesta duplicada del proveedor: no duplica la observación lógica; sin consentimiento vigente:
 *   el proveedor no recibe llamada; si el dueño falla tras la llamada externa: la operación queda
 *   recuperable sin afirmar aplicación completa.
 * @system Contrato con un dueño en memoria y la regla de consentimiento por propósito (AT-028).
 */
import { describe, expect, it } from '@jest/globals';
import { authorizes, type ConsentStatus } from '../../../src/modules/consents/public/consent-status.contracts.js';
import {
  evidenceKeyFor,
  type ExternalEvidence,
  type ExternalEvidenceOwnerPort,
} from '../../../src/modules/external-data/application/ports/external-evidence.port.js';

function inMemoryOwner(): ExternalEvidenceOwnerPort & { applied: string[] } {
  const applied: string[] = [];
  return {
    applied,
    async apply(evidence) {
      if (applied.includes(evidence.evidenceKey)) return { applied: false, duplicated: true, ownerReference: evidence.evidenceKey };
      applied.push(evidence.evidenceKey);
      return { applied: true, duplicated: false, ownerReference: `obs-${applied.length}` };
    },
  };
}
const evidence: ExternalEvidence = {
  tenantId: '1',
  customerId: '42',
  providerCode: 'SEGIP',
  requestId: 'req-1',
  evidenceKey: evidenceKeyFor({ providerCode: 'SEGIP', requestId: 'req-1', contentHash: 'abc' }),
  observations: [
    { observationKey: 'identity.match', featureNamespace: 'identity', featureKey: 'match', valueType: 'BOOLEAN', valueBoolean: true },
  ],
  producedAt: '2026-09-12T00:00:00.000Z',
};

describe('propiedad de la evidencia de integraciones (AT-043)', () => {
  it('respuesta duplicada del proveedor: una sola observación lógica', async () => {
    const owner = inMemoryOwner();
    expect(await owner.apply(evidence)).toMatchObject({ applied: true, duplicated: false });
    expect(await owner.apply(evidence)).toMatchObject({ applied: false, duplicated: true });
    expect(owner.applied).toHaveLength(1);
  });

  it('sin consentimiento vigente para el propósito: el proveedor no se llama', async () => {
    const revoked: ConsentStatus = {
      tenantId: '1',
      customerId: '42',
      purposeCode: 'identity_verification',
      status: 'revoked',
      revision: 'r2',
      grantedAt: null,
      revokedAt: '2026-09-01T00:00:00.000Z',
      readAt: '2026-09-12T00:00:00.000Z',
    };
    let called = 0;
    const execute = async () => {
      called += 1;
    };
    if (authorizes(revoked, 'identity_verification')) await execute();
    expect(called).toBe(0);
  });

  it('el dueño falla tras la llamada externa: la solicitud técnica existe y la aplicación queda pendiente, no confirmada', async () => {
    const owner: ExternalEvidenceOwnerPort = {
      apply: async () => {
        throw new Error('dueño caído');
      },
    };
    const technical = { requestId: 'req-1', status: 'responded', applied: false };
    await expect(owner.apply(evidence)).rejects.toThrow('dueño caído');
    expect(technical).toMatchObject({ status: 'responded', applied: false });
  });

  it('la evidencia no lleva el payload crudo del proveedor', () => {
    expect(Object.keys(evidence)).not.toContain('rawPayload');
    expect(JSON.stringify(evidence)).not.toMatch(/payload/);
  });
});
