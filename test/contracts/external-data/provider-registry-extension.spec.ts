/**
 * @file AT-042 — el registro de proveedores se extiende por composición, no editando la aplicación.
 * @business Un adaptador nuevo se registra añadiéndolo a la colección; los alias heredados siguen
 *   resolviendo; dos adaptadores con el mismo código o un alias en conflicto hacen fallar el arranque.
 * @system `ExternalProviderRegistryService` con colección y alias inyectados; sin Nest.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { ExternalProviderRegistryService } from '../../../src/modules/external-data/application/external-provider-registry.service.js';
import { PROVIDER_ALIASES } from '../../../src/modules/external-data/infrastructure/external-provider.providers.js';

const adapter = (providerCode: string) => ({ providerCode, checkHealth: jest.fn(), execute: jest.fn(), normalize: jest.fn() });
const repository = { findProviderByCode: jest.fn(), listProviders: jest.fn(), createHealthLog: jest.fn() };

describe('extensión del registro de proveedores (AT-042)', () => {
  it('un adaptador fake nuevo se registra sin tocar el algoritmo del registro', () => {
    const registry = new ExternalProviderRegistryService(repository as never, [adapter('SEGIP'), adapter('FAKE_PROVIDER')] as never);
    expect(registry.hasAdapter('FAKE_PROVIDER')).toBe(true);
    expect(registry.requireAdapter('FAKE_PROVIDER').providerCode).toBe('FAKE_PROVIDER');
  });

  it('alias heredados: CGIP → SEGIP y QR_BCB_GENERIC → QR_GENERIC resuelven a la misma instancia', () => {
    const segip = adapter('SEGIP');
    const qr = adapter('QR_GENERIC');
    const registry = new ExternalProviderRegistryService(repository as never, [segip, qr] as never, PROVIDER_ALIASES);
    expect(registry.requireAdapter('CGIP')).toBe(segip);
    expect(registry.requireAdapter('QR_BCB_GENERIC')).toBe(qr);
  });

  it('dos adaptadores con el mismo código: el arranque falla con diagnóstico claro', () => {
    expect(() => new ExternalProviderRegistryService(repository as never, [adapter('SEGIP'), adapter('SEGIP')] as never)).toThrow(
      'EXTERNAL_PROVIDER_CODE_DUPLICATED: SEGIP',
    );
  });

  it('un alias que también es código de adaptador: conflicto detectado al construir', () => {
    expect(() => new ExternalProviderRegistryService(repository as never, [adapter('CGIP')] as never, PROVIDER_ALIASES)).toThrow(
      'EXTERNAL_PROVIDER_ALIAS_CONFLICT: CGIP',
    );
  });
});
