/**
 * @file Ensamblaje de adaptadores de proveedores externos (AT-042).
 * @business Añadir un proveedor es registrar su adaptador aquí; el registro de aplicación no cambia ni
 *   importa clases concretas. Los alias heredados (CGIP→SEGIP, QR_BCB_GENERIC→QR_GENERIC) siguen resolviendo.
 * @system Token de colección + factory Nest + tabla de alias. La validación de códigos y alias
 *   duplicados la hace el registro al construirse y hace fallar el arranque con diagnóstico.
 */
import type { Provider } from '@nestjs/common';
import type { ExternalProviderAdapter } from '../domain/external-provider-adapter.interface.js';
import { BankingGenericAdapter } from './adapters/banking-generic/banking-generic.adapter.js';
import { DigitalTrustGenericAdapter } from './adapters/digital-trust-generic/digital-trust-generic.adapter.js';
import { FacebookMetaAdapter } from './adapters/facebook-meta/facebook-meta.adapter.js';
import { InfoCenterAdapter } from './adapters/infocenter/infocenter.adapter.js';
import { QrGenericAdapter } from './adapters/qr-generic/qr-generic.adapter.js';
import { SegipAdapter } from './adapters/segip/segip.adapter.js';
import { TelcoGenericAdapter } from './adapters/telco-generic/telco-generic.adapter.js';
import { WhatsappAdapter } from './adapters/whatsapp/whatsapp.adapter.js';

export const EXTERNAL_PROVIDER_ADAPTERS = 'atlas.external-data.provider-adapters';
export const EXTERNAL_PROVIDER_ALIASES = 'atlas.external-data.provider-aliases';

/** alias → código canónico. Un alias nunca apunta a otro alias. */
export const PROVIDER_ALIASES: Readonly<Record<string, string>> = Object.freeze({ CGIP: 'SEGIP', QR_BCB_GENERIC: 'QR_GENERIC' });

const ADAPTER_CLASSES = [
  SegipAdapter,
  InfoCenterAdapter,
  QrGenericAdapter,
  BankingGenericAdapter,
  TelcoGenericAdapter,
  FacebookMetaAdapter,
  WhatsappAdapter,
  DigitalTrustGenericAdapter,
];

export const externalProviderProviders: Provider[] = [
  ...ADAPTER_CLASSES,
  { provide: EXTERNAL_PROVIDER_ADAPTERS, useFactory: (...adapters: ExternalProviderAdapter[]) => adapters, inject: ADAPTER_CLASSES },
  { provide: EXTERNAL_PROVIDER_ALIASES, useValue: PROVIDER_ALIASES },
];
