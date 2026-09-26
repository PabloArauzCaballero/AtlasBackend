/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Inject, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { assertAllProvidersConfigured } from '../../../common/resilience/provider-config-validator.js';
import { EXTERNAL_PROVIDER_ADAPTERS, EXTERNAL_PROVIDER_ALIASES, PROVIDER_ALIASES } from '../infrastructure/external-provider.providers.js';
import { ExternalDataRepository } from '../external-data.repository.js';
import { ExternalProviderAdapter } from '../domain/external-provider-adapter.interface.js';
import {
  externalProviderBootRequirements,
  mockBaseUrlFor,
  productionIntegrationBlockers,
  providerModeFromEnv,
} from './external-data-policy.util.js';

@Injectable()
export class ExternalProviderRegistryService implements OnModuleInit {
  private readonly adapters: Map<string, ExternalProviderAdapter>;
  private readonly logger = new Logger(ExternalProviderRegistryService.name);
  /** Proveedores que, con la configuración actual, no pueden ejecutar. Se calcula al arrancar. */
  private blockedProviders: Array<{ providerCode: string; mode: string; blockers: string[] }> = [];

  /**
   * ATLAS-ROBUSTEZ: fail-fast — si un operador activa `${CODE}_MODE=production` para cualquier
   * proveedor externo sin sus credenciales reales, el proceso no arranca. Antes de esto, la
   * primera señal de un `SEGIP_CLIENT_SECRET` faltante era un `PRODUCTION_GATE_BLOCKED` en la
   * primera request real de un cliente en producción.
   */
  async onModuleInit(): Promise<void> {
    assertAllProvidersConfigured(externalProviderBootRequirements());
    await this.reportBlockedProviders();
  }

  /**
   * Hallazgo A-02: el modo efectivo de cada proveedor vive en la BASE (`default_mode`), no solo en
   * `env`, así que el fail-fast síncrono de arriba no puede verlo. Esto lo audita al arrancar y lo
   * deja visible en el log y en `/external-data/providers/readiness`, para que un despliegue
   * productivo con proveedores en modo simulado se note antes de la primera request, no después.
   *
   * NO tumba el proceso: un backend que no puede consultar buró debe seguir sirviendo login,
   * onboarding y consultas. Las requests a esos proveedores fallan cerradas una a una.
   */
  private async reportBlockedProviders(): Promise<void> {
    try {
      const providers = await this.repository.listProviders();
      this.blockedProviders = providers
        .filter((provider) => provider)
        .map((provider) => {
          const providerCode = String(provider.providerCode);
          const mode = providerModeFromEnv(providerCode, provider.defaultMode);
          return { providerCode, mode, blockers: productionIntegrationBlockers(providerCode, mode) };
        })
        .filter((entry) => entry.blockers.length > 0);

      for (const entry of this.blockedProviders) {
        this.logger.error(
          `Proveedor externo ${entry.providerCode} NO puede ejecutar (modo ${entry.mode}): ${entry.blockers.join(', ')}. ` +
            'Las requests a este proveedor responderán PROVIDER_UNAVAILABLE hasta que se configure la integración real.',
        );
      }
    } catch (error) {
      // Sin base disponible al arrancar, la auditoría se pierde pero el portón por request sigue
      // vigente: es un aviso menos, no un agujero.
      this.logger.warn(
        `No se pudo auditar el modo de los proveedores externos al arrancar: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Proveedores bloqueados detectados al arrancar. Lo consume la readiness de external-data. */
  listBlockedProviders(): ReadonlyArray<{ providerCode: string; mode: string; blockers: string[] }> {
    return this.blockedProviders;
  }

  private readonly aliases: Readonly<Record<string, string>>;

  constructor(
    private readonly repository: ExternalDataRepository,
    // AT-042: la aplicación recibe la colección; las clases concretas se ensamblan en infraestructura.
    @Inject(EXTERNAL_PROVIDER_ADAPTERS) adapters: ExternalProviderAdapter[],
    @Optional() @Inject(EXTERNAL_PROVIDER_ALIASES) aliases: Readonly<Record<string, string>> = PROVIDER_ALIASES,
  ) {
    this.aliases = aliases;
    this.adapters = new Map();
    for (const adapter of adapters) {
      if (!adapter?.providerCode) throw new Error('EXTERNAL_PROVIDER_ADAPTER_WITHOUT_CODE');
      if (this.adapters.has(adapter.providerCode)) throw new Error(`EXTERNAL_PROVIDER_CODE_DUPLICATED: ${adapter.providerCode}`);
      this.adapters.set(adapter.providerCode, adapter);
    }
    for (const [alias, canonical] of Object.entries(this.aliases)) {
      if (this.adapters.has(alias)) throw new Error(`EXTERNAL_PROVIDER_ALIAS_CONFLICT: ${alias} es alias y código a la vez`);
      if (alias in this.aliases && canonical in this.aliases) throw new Error(`EXTERNAL_PROVIDER_ALIAS_CHAIN: ${alias}→${canonical}`);
    }
  }

  /** Código canónico: resuelve alias heredados sin que el resto del servicio los conozca. */
  private canonical(providerCode: string): string {
    return this.aliases[providerCode] ?? providerCode;
  }

  hasAdapter(providerCode: string): boolean {
    return this.adapters.has(this.canonical(providerCode));
  }

  requireAdapter(providerCode: string): ExternalProviderAdapter {
    const adapter = this.adapters.get(this.canonical(providerCode));
    if (!adapter) throw new NotFoundException(`Adapter externo no implementado: ${providerCode}`);
    return adapter;
  }

  async requireProvider(providerCode: string) {
    const provider = await this.repository.findProviderByCode(this.canonical(providerCode));
    if (!provider || provider.isActive === false) throw new NotFoundException(`Provider externo no configurado: ${providerCode}`);
    return provider;
  }

  async requireProviderAllowDisabled(providerCode: string) {
    const provider = await this.repository.findProviderByCode(this.canonical(providerCode));
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
