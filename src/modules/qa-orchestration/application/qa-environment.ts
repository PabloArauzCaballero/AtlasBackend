/**
 * @file Servicio de aplicación: el entorno QA administrado en el servidor y su preparación real.
 * @business Esta pieza responde «¿se puede ejecutar aquí, con qué topes, y está el worker vivo?»
 *   antes de ofrecer el botón.
 * @system entorno desde configuración de despliegue; readiness del worker por latido reciente y del
 *   mock por su catálogo, con caché corta para no martillear en cada sondeo del portal.
 */
import { Injectable } from '@nestjs/common';
import { env } from '../../../config/env.js';
import { deploymentEnvironment, qaExecutionAllowed } from '../../../platform/security/qa-execution-context.js';
import type { QaEnvironmentPolicy } from '../domain/qa-run.types.js';
import type { RuntimeReadiness } from '../domain/journey-plan.js';
import { probePlatformService } from '../../systems-ops/platform-service-health.probe.js';
import { MockControlClient } from '../infrastructure/mock-control.client.js';
import { QaRunQueryRepository } from '../infrastructure/qa-run-query.repository.js';

/** Un worker se considera vivo si latió en los últimos 3 intervalos (mínimo 30 s). */
export function workerLivenessSeconds(): number {
  return Math.max(30, Math.ceil((env.RUNTIME_JOBS_QA_CONSUMER_INTERVAL_MS * 3) / 1000));
}

@Injectable()
export class QaEnvironmentService {
  readonly mock = new MockControlClient({ controlUrl: env.MOCK_PROVIDERS_CONTROL_URL, controlToken: env.MOCK_PROVIDERS_CONTROL_TOKEN });
  private mockCache: { at: number; value: Awaited<ReturnType<MockControlClient['capabilities']>> } | null = null;
  private engineCache: { at: number; value: boolean } | null = null;

  constructor(private readonly query: QaRunQueryRepository) {}

  /** Motivo por el que QA no se puede ejecutar aquí, o `null` si se puede. */
  disabledReason(): string | null {
    if (deploymentEnvironment() === 'PROD') return 'Producción no admite corridas QA.';
    if (!qaExecutionAllowed()) return 'Las corridas QA están apagadas en este entorno (QA_EXECUTION_ENABLED).';
    if (!env.QA_EXECUTION_SECRET) return 'Falta QA_EXECUTION_SECRET: el worker no puede firmar sus peticiones.';
    if (!env.QA_TARGET_BASE_URL) return 'Falta QA_TARGET_BASE_URL: no hay un backend QA de destino.';
    return null;
  }

  environments(): QaEnvironmentPolicy[] {
    return [
      {
        environmentId: env.QA_TARGET_ENVIRONMENT_ID,
        label: env.QA_TARGET_LABEL,
        deploymentEnvironment: deploymentEnvironment(),
        maxPersons: env.QA_MAX_PERSONS,
        maxConcurrency: env.QA_MAX_CONCURRENCY,
        limits: {
          maxRequests: env.QA_MAX_REQUESTS,
          maxDurationMs: env.QA_MAX_DURATION_MS,
          maxInFlightRequests: env.QA_MAX_IN_FLIGHT_REQUESTS,
        },
      },
    ];
  }

  environment(environmentId: string): QaEnvironmentPolicy | undefined {
    return this.environments().find((candidate) => candidate.environmentId === environmentId);
  }

  async mockCapabilities() {
    if (this.mockCache && Date.now() - this.mockCache.at < 15_000) return this.mockCache.value;
    const value = await this.mock.capabilities();
    this.mockCache = { at: Date.now(), value };
    return value;
  }

  /** El Motor responde a su healthcheck. Sin dirección configurada no hay Motor, no «quizá». */
  async decisionEngineReachable(): Promise<boolean> {
    if (this.engineCache && Date.now() - this.engineCache.at < 15_000) return this.engineCache.value;
    const probe = await probePlatformService('DECISION_ENGINE');
    const value = probe?.isHealthy === true;
    this.engineCache = { at: Date.now(), value };
    return value;
  }

  async readiness(): Promise<RuntimeReadiness & { lastWorkerSeenAt: Date | null }> {
    const [workers, mock, engine] = await Promise.all([
      this.query.liveWorkers(workerLivenessSeconds()),
      this.mockCapabilities(),
      this.decisionEngineReachable(),
    ]);
    return {
      workerReady: workers.count > 0 && this.disabledReason() === null,
      lastWorkerSeenAt: workers.lastSeenAt,
      // Sin token de control no hay namespace por corrida ni journal: la evidencia no se podría cruzar.
      mockReachable: mock.reachable && this.mock.configured,
      mockScenarios: mock.scenarios,
      // Sin operador QA provisionado, las plantillas que lo necesitan se bloquean con ACTOR_UNAVAILABLE
      // en vez de usar otra sesión.
      // El usuario de comercio lo provisiona el operador QA dentro de la receta: existe si existe él.
      availableActors: env.QA_INTERNAL_ACTOR_EMAIL && env.QA_INTERNAL_ACTOR_PASSWORD ? ['internal_user', 'merchant_user'] : [],
      platformServices: { DECISION_ENGINE: engine },
    };
  }
}
