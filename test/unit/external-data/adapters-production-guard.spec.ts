import { describe, expect, it } from '@jest/globals';
import { BankingGenericAdapter } from '../../../src/modules/external-data/infrastructure/adapters/banking-generic/banking-generic.adapter.js';
import { DigitalTrustGenericAdapter } from '../../../src/modules/external-data/infrastructure/adapters/digital-trust-generic/digital-trust-generic.adapter.js';
import { FacebookMetaAdapter } from '../../../src/modules/external-data/infrastructure/adapters/facebook-meta/facebook-meta.adapter.js';
import { InfoCenterAdapter } from '../../../src/modules/external-data/infrastructure/adapters/infocenter/infocenter.adapter.js';
import { QrGenericAdapter } from '../../../src/modules/external-data/infrastructure/adapters/qr-generic/qr-generic.adapter.js';
import { SegipAdapter } from '../../../src/modules/external-data/infrastructure/adapters/segip/segip.adapter.js';
import { TelcoGenericAdapter } from '../../../src/modules/external-data/infrastructure/adapters/telco-generic/telco-generic.adapter.js';
import { WhatsappAdapter } from '../../../src/modules/external-data/infrastructure/adapters/whatsapp/whatsapp.adapter.js';
import { ExternalProviderExecutionInput } from '../../../src/modules/external-data/domain/external-provider.types.js';

/**
 * NINGÚN adaptador tiene todavía integración real con su proveedor. El portón que lo impide en
 * producción (`productionIntegrationBlockers`) depende de que `${CODE}_REAL_INTEGRATION_IMPLEMENTED`
 * diga la verdad, y esa es una variable de entorno que un operador puede poner en `true` sin que
 * exista integración alguna.
 *
 * Cinco de los ocho adaptadores no tenían guarda propia y, con esa bandera mentida, habrían servido
 * un payload FABRICADO etiquetado como producción — evidencia KYC inventada persistida como features
 * del cliente. Esta prueba fija que cada adaptador se niega por sí mismo, sin depender de que la
 * configuración sea honesta.
 *
 * Cuando un proveedor obtenga integración real, esta prueba debe cambiar para ESE proveedor: es la
 * señal de que hay que revisarla, no un obstáculo.
 */
describe('adaptadores externos — guarda de producción propia', () => {
  const adapters = [
    ['SEGIP', new SegipAdapter()],
    ['INFOCENTER', new InfoCenterAdapter()],
    ['QR_GENERIC', new QrGenericAdapter()],
    ['BANKING_GENERIC', new BankingGenericAdapter()],
    ['TELCO_GENERIC', new TelcoGenericAdapter()],
    ['FACEBOOK_META', new FacebookMetaAdapter()],
    ['WHATSAPP_GENERIC', new WhatsappAdapter()],
    ['DIGITAL_TRUST_GENERIC', new DigitalTrustGenericAdapter()],
  ] as Array<[string, { execute: (input: ExternalProviderExecutionInput) => Promise<unknown> }]>;

  const inputFor = (mode: ExternalProviderExecutionInput['mode']): ExternalProviderExecutionInput =>
    ({
      tenantId: '1',
      providerCode: 'X',
      queryType: 'IDENTITY_VERIFICATION',
      purpose: 'ONBOARDING',
      decisionStage: 'ONBOARDING',
      mode,
      input: {},
    }) as ExternalProviderExecutionInput;

  it.each(adapters)('%s se niega a ejecutar en modo production', async (_code, adapter) => {
    await expect(adapter.execute(inputFor('production'))).rejects.toThrow(/NOT_CONFIGURED|NOT_IMPLEMENTED/);
  });

  it.each(adapters)('%s se niega a ejecutar en modo sandbox', async (_code, adapter) => {
    await expect(adapter.execute(inputFor('sandbox'))).rejects.toThrow(/NOT_CONFIGURED|NOT_IMPLEMENTED/);
  });
});
