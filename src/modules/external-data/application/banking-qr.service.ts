/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ExternalProviderExecutionInput } from '../domain/external-provider.types.js';
import { BankingGenericAdapter } from '../infrastructure/adapters/banking-generic/banking-generic.adapter.js';
import { BankQrResult } from '../infrastructure/adapters/banking-generic/banking-qr.util.js';
import { mockBaseUrlFor, productionIntegrationBlockers, providerModeFromEnv } from './external-data-policy.util.js';
import { ExternalProviderRegistryService } from './external-provider-registry.service.js';

const PROVIDER_CODE = 'BANKING_GENERIC';

export type BankQrGenerationResult = BankQrResult & {
  providerCode: string;
  mode: string;
  customerId: string;
};

/**
 * Flujo dedicado de generación de QR de cobro para BANKING_GENERIC. A diferencia de las
 * verificaciones (que pasan por el pipeline de observaciones de riesgo), generar un QR es una
 * ACCIÓN que devuelve un QR — no una señal de riesgo — así que no persiste observaciones/features.
 * Resuelve el modo igual que el resto de external-data (env `BANKING_GENERIC_MODE` ⇒ defaultMode del
 * provider ⇒ mock_local) y delega en el adapter, que decide mock_server vs generación en proceso.
 */
@Injectable()
export class BankingQrService {
  constructor(
    private readonly registry: ExternalProviderRegistryService,
    private readonly bankingAdapter: BankingGenericAdapter,
  ) {}

  async generateQr(input: {
    tenantId: string;
    customerId: string;
    amount: number;
    currency: string;
    reference?: string;
    scenario?: string;
    requestedByUserId?: string;
  }): Promise<BankQrGenerationResult> {
    const provider = await this.registry.requireProviderAllowDisabled(PROVIDER_CODE);
    const mode = providerModeFromEnv(PROVIDER_CODE, provider.defaultMode);

    // A diferencia de las verificaciones, este flujo no pasa por el pipeline de políticas de
    // `ExternalDataExecutionService`, así que aplica el mismo portón aquí. Es el caso más grave de
    // los que cubre A-02: un QR de COBRO generado en modo simulado es un QR al que un cliente le
    // transfiere dinero de verdad. Se prefiere 503 a devolver un QR que no cobra a nadie.
    const blockers = productionIntegrationBlockers(PROVIDER_CODE, mode);
    if (blockers.length > 0) {
      throw new ServiceUnavailableException(`PRODUCTION_GATE_BLOCKED:${blockers.join(',')}`);
    }

    const executionInput: ExternalProviderExecutionInput = {
      tenantId: input.tenantId,
      customerId: input.customerId,
      providerCode: PROVIDER_CODE,
      // queryType/purpose/decisionStage son requeridos por el tipo pero no los usa generateQr
      // (no hay pipeline de observaciones aquí); se reusan los de la vertical bancaria.
      queryType: 'BANK_TRANSFER_VERIFICATION',
      purpose: 'PAYMENT_RECONCILIATION',
      decisionStage: 'PAYMENT_RECONCILIATION',
      mode,
      input: { amount: input.amount, currency: input.currency, reference: input.reference },
      scenario: input.scenario as ExternalProviderExecutionInput['scenario'],
      requestedByUserId: input.requestedByUserId,
      mockBaseUrl: mockBaseUrlFor(PROVIDER_CODE),
    };

    const qr = await this.bankingAdapter.generateQr(executionInput);
    return { ...qr, providerCode: PROVIDER_CODE, mode, customerId: input.customerId };
  }
}
