/**
 * @file Puerto tipado: desacopla un caso de uso de su implementación.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import {
  ExternalProviderExecutionInput,
  ExternalProviderRawResult,
  NormalizedExternalObservation,
  ProviderHealthResult,
} from './external-provider.types.js';

export interface ExternalProviderAdapter {
  providerCode: string;

  checkHealth(mode: ExternalProviderExecutionInput['mode'], mockBaseUrl?: string): Promise<ProviderHealthResult>;

  execute(request: ExternalProviderExecutionInput): Promise<ExternalProviderRawResult>;

  normalize(raw: ExternalProviderRawResult, context: ExternalProviderExecutionInput): Promise<NormalizedExternalObservation[]>;
}
