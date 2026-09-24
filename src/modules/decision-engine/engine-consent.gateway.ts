/**
 * @file Adaptador de infraestructura: réplica duradera del consentimiento del titular en el motor (P-09, B12).
 * @business Una revocación hecha con el motor caído no se pierde: queda pendiente y se reintenta hasta que llega.
 * @system escribe el estado deseado en la cola, intenta la entrega por el plano de gobierno y acusa o reprograma.
 */
import { Logger } from '@nestjs/common';
import { env } from '../../config/env.js';
import type { ConsentReplicationStore } from './consent-replication.store.js';
import type { EngineTransportService } from './engine-transport.service.js';

export type ConsentBasis = 'CONSENT' | 'CONTRACT' | 'LEGAL_OBLIGATION' | 'CREDIT_PROTECTION' | 'LEGITIMATE_INTEREST';

/** Quién y para qué. `tenantId`/`customerId` hacen la réplica duradera; sin ellos es sólo un intento. */
export type ConsentReplicationInput = {
  subjectReference: string;
  purpose: string;
  tenantId?: string;
  customerId?: string;
  expiresAt?: Date | null;
  evidenceRef?: string | null;
};

/**
 * La mitad del cliente del motor que habla de consentimientos.
 *
 * Vive aparte del cliente por tamaño y porque tiene estado propio (la cola); el cliente la expone
 * como `consents` y conserva `recordConsent`/`revokeConsent` para quien ya los llamaba.
 */
export class EngineConsentGateway {
  private readonly logger = new Logger(EngineConsentGateway.name);

  constructor(
    private readonly transport: EngineTransportService,
    private readonly isConfigured: () => boolean,
    private readonly store?: ConsentReplicationStore,
  ) {}

  /**
   * Entrega UNA réplica al motor y lanza si no llegó. Es lo que usa el reintentador; las llamadas
   * de negocio pasan por `recordConsent`/`revokeConsent`, que nunca lanzan.
   *
   * Va por el plano de GOBIERNO (o, si falta, el de desenlaces); nunca por la llave de ejecución:
   * quien decide no puede escribir el permiso que le autoriza a decidir.
   */
  async deliverConsent(input: {
    action: 'grant' | 'revoke';
    subjectReference: string;
    purpose: string;
    basis?: string | null;
    grantedAt?: Date | null;
    expiresAt?: Date | null;
    evidenceRef?: string | null;
  }): Promise<void> {
    const apiKey = env.DECISION_ENGINE_GOVERNANCE_API_KEY ?? env.DECISION_ENGINE_OUTCOME_API_KEY ?? '';
    if (input.action === 'revoke') {
      const url = `${this.transport.baseUrl()}/v1/risk-governance/consents/revoke`;
      await this.transport.call(url, apiKey, { subjectReference: input.subjectReference, purpose: input.purpose });
      return;
    }
    const url = `${this.transport.baseUrl()}/v1/risk-governance/consents`;
    await this.transport.call(url, apiKey, {
      subjectReference: input.subjectReference,
      purpose: input.purpose,
      basis: input.basis,
      grantedAt: (input.grantedAt ?? new Date()).toISOString(),
      ...(input.expiresAt ? { expiresAt: input.expiresAt.toISOString() } : {}),
      ...(input.evidenceRef ? { evidenceRef: input.evidenceRef } : {}),
    });
  }

  /**
   * Escribe el estado deseado (si hay a quién atribuirlo) y lo intenta entregar. Nunca lanza.
   *
   * Si la cola rechaza la petición por estar superada —un permiso más viejo que una revocación ya
   * pedida—, NO se entrega: mandarlo resucitaría en el motor lo que el titular retiró.
   */
  async replicate(
    input: ConsentReplicationInput & { action: 'grant' | 'revoke'; basis: ConsentBasis | null; grantedAt: Date | null },
  ): Promise<boolean> {
    const pending = await this.persist(input);
    if (pending === 'superseded') {
      this.logger.warn(`Réplica de consentimiento (${input.action}) superada por una revocación posterior: no se entrega.`);
      return false;
    }
    if (!this.isConfigured()) return false;
    try {
      await this.deliverConsent(input);
      if (pending) await this.store?.markSynced(pending.id, pending.requestedAt, new Date());
      return true;
    } catch (error) {
      const message = (error as Error).message;
      this.logger.warn(`No se pudo replicar el consentimiento (${input.action}) en el motor; queda pendiente de reintento: ${message}`);
      if (pending) await this.store?.markFailed({ id: pending.id, attempts: 0, requestedAt: pending.requestedAt }, message, new Date());
      return false;
    }
  }

  private async persist(
    input: ConsentReplicationInput & { action: 'grant' | 'revoke'; basis: ConsentBasis | null; grantedAt: Date | null },
  ): Promise<{ id: string; requestedAt: Date } | 'superseded' | null> {
    if (!this.store || !input.tenantId || !input.customerId) return null;
    const row = await this.store.request({
      tenantId: input.tenantId,
      customerId: input.customerId,
      subjectReference: input.subjectReference,
      purposeCode: input.purpose,
      action: input.action,
      basis: input.basis,
      grantedAt: input.grantedAt,
      expiresAt: input.expiresAt ?? null,
      now: new Date(),
    });
    return row ?? 'superseded';
  }
}
