/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ResilientAdapterExecutorService } from '../../../common/resilience/resilient-adapter-executor.service.js';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { redactSensitiveObject, stableStringify } from '../../../common/utils/privacy/redaction.util.js';
import { DataProviderRequestModel, ExternalProviderCostPolicyModel } from '../../../database/models/index.js';
import { ExternalProviderAdapter } from '../domain/external-provider-adapter.interface.js';
import {
  ExternalDataRequestResult,
  ExternalProviderExecutionInput,
  ExternalProviderRawResult,
  ExternalProviderStatus,
  NormalizedExternalObservation,
} from '../domain/external-provider.types.js';
import { contractViolationReason, validateProviderResponse } from '../domain/provider-response.contract.js';
import { ExternalCustomerEvidenceRepository } from '../infrastructure/external-customer-evidence.repository.js';
import { ExternalProviderRequestRepository } from '../infrastructure/external-provider-request.repository.js';
import { featuresFromObservations, statusFromRaw } from './external-data-policy.util.js';

/** Todo lo que la llamada al adaptador necesita de la orquestación que ya registró la solicitud. */
export interface ExternalProviderCallInput {
  request: DataProviderRequestModel;
  providerId: string;
  adapter: ExternalProviderAdapter;
  executionInput: ExternalProviderExecutionInput;
  policy: ExternalProviderCostPolicyModel | null;
}

/** Lo que quedó de una llamada exitosa al adaptador, listo para persistir. */
interface AdapterOutcome {
  raw: ExternalProviderRawResult;
  status: ExternalProviderStatus;
  observations: NormalizedExternalObservation[];
  features: Record<string, unknown>;
  missingFeaturesJson: Record<string, unknown>;
  redactedPayload: Record<string, unknown>;
  responseHash: string;
  contractViolations: ReturnType<typeof validateProviderResponse>;
}

/**
 * Llama al adaptador del proveedor con reintentos, valida el contrato de la respuesta, normaliza y
 * persiste respuesta, observaciones y features en una transacción. Extraído de
 * `ExternalDataExecutionService`, que decide SI se llama; aquí se decide qué pasó al llamar.
 */
@Injectable()
export class ExternalProviderCallService {
  constructor(
    private readonly requestRepository: ExternalProviderRequestRepository,
    private readonly evidenceRepository: ExternalCustomerEvidenceRepository,
    private readonly resilience: ResilientAdapterExecutorService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async callAdapter(input: ExternalProviderCallInput): Promise<ExternalDataRequestResult> {
    const { request, adapter, executionInput, policy } = input;
    const { providerCode, mode } = executionInput;
    try {
      // ATLAS-ROBUSTEZ: `retryMaxAttempts`/`retryBackoffSeconds` ya existían como columnas de
      // `external_provider_cost_policies` (y se leían en `mapCostPolicy` para el preview), pero
      // nunca se aplicaban a la ejecución real del adaptador — cualquier política que los
      // configurara no tenía ningún efecto. Ahora alimentan el kernel de resiliencia compartido
      // (`ResilientAdapterExecutorService`, el mismo que usan los adapters de `notifications`):
      // un fallo transitorio del adaptador (`AdapterError.retryable`, p. ej. timeout o 5xx una
      // vez que exista una integración real) se reintenta con backoff antes de marcar el
      // request como `FAILED`. Sin política configurada, el default es 1 intento (sin retry) —
      // mismo comportamiento observable para llamadas sin política de costo configurada.
      //
      // El suelo es 1: las políticas sembradas escriben `retry_max_attempts = 0` para decir «sin
      // reintentos» (proveedores con costo), y pasado tal cual eran CERO intentos: el adaptador no
      // se llamaba nunca y la consulta salía `FAILED` con `RETRY_LOOP_EXHAUSTED_WITHOUT_ERROR`
      // (INFOCENTER, WhatsApp, confianza social y digital). Medido el 2026-09-24 en una corrida QA.
      const raw = await this.resilience.run(() => adapter.execute(executionInput), {
        provider: providerCode,
        maxAttempts: Math.max(1, policy?.retryMaxAttempts ?? 1),
        baseDelayMs: policy?.retryBackoffSeconds ? policy.retryBackoffSeconds * 1000 : 200,
      });
      // Un 200 con el contrato roto NO puede seguir hacia `normalize()`.
      //
      // Los normalizadores rellenan lo que falta —`num(payload.matchScore) ?? 0`,
      // `bool(payload.documentExists) ?? status === 'FOUND'`— así que una respuesta `{"status":
      // "FOUND"}` sin un solo dato de la verificación salía del pipeline como cinco observaciones
      // bien formadas, indistinguibles de una identidad de baja coincidencia. El cambio
      // incompatible de un proveedor no rompía nada: degradaba en silencio la evidencia de un
      // expediente KYC. Ahora es un fallo identificable, con los campos que faltaron, y sin
      // observaciones inventadas.
      const contractViolations = validateProviderResponse(providerCode, raw.payload, String(raw.status));
      const contractBroken = contractViolations.length > 0;
      const observations = contractBroken ? [] : await adapter.normalize(raw, executionInput);
      const features = featuresFromObservations(observations);
      const missingFeaturesJson = observations
        .filter((observation) => observation.valueString === 'DATA_NOT_AVAILABLE')
        .reduce<Record<string, unknown>>((acc, observation) => {
          acc[observation.featureKey] = 'DATA_NOT_AVAILABLE';
          return acc;
        }, {});
      const status = contractBroken ? 'FAILED' : statusFromRaw(raw);
      const redactedPayload = redactSensitiveObject(raw.payload) as Record<string, unknown>;
      const responseHash = sha256Hex(stableStringify(redactedPayload));
      // Sin observaciones no hay quien pida revisión manual, y una respuesta que no se pudo
      // interpretar es exactamente el caso que un humano tiene que mirar.
      const manualReviewRequired = contractBroken || observations.some((observation) => observation.manualReviewRequired === true);

      await this.persistOutcome(input, {
        raw,
        status,
        observations,
        features,
        missingFeaturesJson,
        redactedPayload,
        responseHash,
        contractViolations,
      });

      return {
        requestId: String(request.id),
        providerCode,
        status,
        // El veredicto del proveedor viaja aparte del estado de ejecución: `status` colapsa a MOCKED
        // toda respuesta simulada, así que quien decide identidad/crédito lo perdería.
        providerVerdict: String(raw.status),
        reasonCode: contractBroken ? contractViolationReason(contractViolations) : String(raw.payload.reasonCode ?? raw.status),
        observations,
        features,
        manualReviewRequired,
        modeUsed: mode,
      };
    } catch (error) {
      const safeError = error instanceof Error ? error.message : 'UNKNOWN_PROVIDER_ERROR';
      await this.requestRepository.updateProviderRequest(request, {
        responseStatus: 'FAILED',
        responseCode: 'PROVIDER_EXECUTION_FAILED',
        respondedAt: new Date(),
        errorMessageSafe: safeError,
      });
      return {
        requestId: String(request.id),
        providerCode,
        status: 'FAILED',
        reasonCode: safeError,
        observations: [],
        features: {},
        manualReviewRequired: true,
        modeUsed: mode,
      };
    }
  }

  /** Guarda en UNA transacción el cierre de la solicitud, la respuesta saneada, las observaciones y el snapshot de features. */
  private async persistOutcome(
    { request, providerId, executionInput, policy }: ExternalProviderCallInput,
    { raw, status, observations, features, missingFeaturesJson, redactedPayload, responseHash, contractViolations }: AdapterOutcome,
  ): Promise<void> {
    const { providerCode } = executionInput;
    const contractBroken = contractViolations.length > 0;
    await this.sequelize.transaction(async (transaction) => {
      await this.requestRepository.updateProviderRequest(
        request,
        {
          responseStatus: status,
          responseCode: String(raw.status),
          latencyMs: raw.latencyMs,
          respondedAt: new Date(),
          providerRequestRef: raw.providerReference,
          actualCostAmount: policy ? String(policy.unitCostAmount) : undefined,
          errorMessageSafe: contractBroken ? contractViolationReason(contractViolations) : undefined,
          metadataJson: {
            providerCode,
            isMocked: raw.isMocked,
            scenario: executionInput.scenario ?? null,
            // Los campos concretos que faltaron quedan en la evidencia: sin ellos, diagnosticar
            // un cambio de contrato del proveedor obliga a reproducir la llamada.
            ...(contractBroken ? { contractViolations } : {}),
          },
        },
        { transaction },
      );
      await this.requestRepository.createProviderResponse(
        {
          tenantId: executionInput.tenantId,
          providerRequestId: String(request.id),
          redactedPayloadJson: redactedPayload,
          normalizedPayloadJson: { observations, features },
          responseHash,
          providerStatusCode: raw.statusCode,
          providerReference: raw.providerReference,
          containsSensitiveData: true,
          now: new Date(),
        },
        { transaction },
      );
      if (executionInput.customerId) {
        await this.evidenceRepository.createObservations(
          {
            tenantId: executionInput.tenantId,
            customerId: executionInput.customerId,
            providerId: providerId,
            requestId: String(request.id),
            observations,
            now: new Date(),
          },
          { transaction },
        );
        await this.evidenceRepository.createFeatureSnapshot(
          {
            tenantId: executionInput.tenantId,
            customerId: executionInput.customerId,
            providerCode,
            requestId: String(request.id),
            featuresJson: features,
            missingFeaturesJson,
            integrityHash: sha256Hex(stableStringify(features)),
            now: new Date(),
          },
          { transaction },
        );
      }
    });
  }
}
