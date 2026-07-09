import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { assertAllProvidersConfigured } from '../../../common/resilience/provider-config-validator.js';
import { ExternalDataRepository } from '../external-data.repository.js';
import { ExternalProviderAdapter } from '../domain/external-provider-adapter.interface.js';
import { SegipAdapter } from '../infrastructure/adapters/segip/segip.adapter.js';
import { InfoCenterAdapter } from '../infrastructure/adapters/infocenter/infocenter.adapter.js';
import { QrGenericAdapter } from '../infrastructure/adapters/qr-generic/qr-generic.adapter.js';
import { BankingGenericAdapter } from '../infrastructure/adapters/banking-generic/banking-generic.adapter.js';
import { TelcoGenericAdapter } from '../infrastructure/adapters/telco-generic/telco-generic.adapter.js';
import { FacebookMetaAdapter } from '../infrastructure/adapters/facebook-meta/facebook-meta.adapter.js';
import { WhatsappAdapter } from '../infrastructure/adapters/whatsapp/whatsapp.adapter.js';
import { DigitalTrustGenericAdapter } from '../infrastructure/adapters/digital-trust-generic/digital-trust-generic.adapter.js';
import { externalProviderBootRequirements, mockBaseUrlFor, providerModeFromEnv } from './external-data-policy.util.js';

@Injectable()
export class ExternalProviderRegistryService implements OnModuleInit {
  private readonly adapters: Map<string, ExternalProviderAdapter>;

  /**
   * ATLAS-ROBUSTEZ: fail-fast — si un operador activa `${CODE}_MODE=production` para cualquier
   * proveedor externo sin sus credenciales reales, el proceso no arranca. Antes de esto, la
   * primera señal de un `SEGIP_CLIENT_SECRET` faltante era un `PRODUCTION_GATE_BLOCKED` en la
   * primera request real de un cliente en producción.
   */
  onModuleInit(): void {
    assertAllProvidersConfigured(externalProviderBootRequirements());
  }

  constructor(
    private readonly repository: ExternalDataRepository,
    segipAdapter: SegipAdapter,
    infoCenterAdapter: InfoCenterAdapter,
    qrGenericAdapter: QrGenericAdapter,
    bankingGenericAdapter: BankingGenericAdapter,
    telcoGenericAdapter: TelcoGenericAdapter,
    facebookMetaAdapter: FacebookMetaAdapter,
    whatsappAdapter: WhatsappAdapter,
    digitalTrustGenericAdapter: DigitalTrustGenericAdapter,
  ) {
    this.adapters = new Map(
      [
        segipAdapter,
        infoCenterAdapter,
        qrGenericAdapter,
        bankingGenericAdapter,
        telcoGenericAdapter,
        facebookMetaAdapter,
        whatsappAdapter,
        digitalTrustGenericAdapter,
      ].flatMap((adapter) => {
        const entries: [string, ExternalProviderAdapter][] = [[adapter.providerCode, adapter]];
        if (adapter.providerCode === 'SEGIP') entries.push(['CGIP', adapter]);
        if (adapter.providerCode === 'QR_GENERIC') entries.push(['QR_BCB_GENERIC', adapter]);
        return entries;
      }),
    );
  }

  hasAdapter(providerCode: string): boolean {
    return this.adapters.has(providerCode === 'CGIP' ? 'SEGIP' : providerCode);
  }

  requireAdapter(providerCode: string): ExternalProviderAdapter {
    const adapter = this.adapters.get(providerCode === 'CGIP' ? 'SEGIP' : providerCode);
    if (!adapter) throw new NotFoundException(`Adapter externo no implementado: ${providerCode}`);
    return adapter;
  }

  async requireProvider(providerCode: string) {
    const provider = await this.repository.findProviderByCode(providerCode === 'CGIP' ? 'SEGIP' : providerCode);
    if (!provider || provider.isActive === false) throw new NotFoundException(`Provider externo no configurado: ${providerCode}`);
    return provider;
  }

  async requireProviderAllowDisabled(providerCode: string) {
    const provider = await this.repository.findProviderByCode(providerCode === 'CGIP' ? 'SEGIP' : providerCode);
    if (!provider) throw new NotFoundException(`Provider externo no configurado: ${providerCode}`);
    return provider;
  }

  async listProviders() {
    const providers = await this.repository.listProviders();
    return providers.map((provider) => ({
      id: String(provider.id),
      code: provider.providerCode,
      name: provider.providerName,
      category: provider.providerCategory ?? provider.providerType,
      status: provider.providerStatus ?? (provider.isActive ? 'ACTIVE' : 'DISABLED'),
      defaultMode: provider.defaultMode,
      requiresConsent: provider.requiresConsent,
      requiresManualApproval: provider.requiresManualApproval,
      isCostly: provider.isCostly,
      description: provider.description,
    }));
  }

  async getProviderHealth(providerCode?: string) {
    const providers = providerCode ? [await this.requireProvider(providerCode)] : await this.repository.listProviders();
    const results = [];
    for (const provider of providers) {
      if (!provider) continue;
      const code = String(provider.providerCode);
      const adapter = this.requireAdapter(code);
      const mode = providerModeFromEnv(code, provider.defaultMode);
      const health = await adapter.checkHealth(mode, mockBaseUrlFor(code));
      await this.repository.createHealthLog({ providerId: String(provider.id), health });
      results.push({ ...health, providerCode: code });
    }
    return results;
  }
}
