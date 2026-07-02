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
