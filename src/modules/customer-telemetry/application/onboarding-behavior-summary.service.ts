/**
 * @file Servicio de aplicación: calcula y guarda el resumen de comportamiento de un alta.
 * @business Es lo que el Motor recibe como «cómo se hizo el alta» al verificar identidad, y lo que el analista ve en la cola.
 * @system lee los eventos del último flujo del cliente, aplica el cálculo puro y escribe una fila nueva del resumen.
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnboardingBehaviorReadRepository } from '../onboarding-behavior-read.repository.js';
import { TelemetryBehaviorRepository } from '../telemetry-behavior.repository.js';
import { calcularResumen, type ResumenCalculado } from './onboarding-behavior-summary.calculo.js';

export type Disparador = 'identity_start' | 'submit' | 'operations_read';

/** Lo que ve quien pide el resumen: las cifras y de qué flujo salieron. */
export type ResumenDeComportamiento = ResumenCalculado & {
  onboardingFlowId: string | null;
  summaryId: string | null;
  computedAt: string;
  disparador: Disparador;
};

/**
 * ## Una fila nueva por cálculo
 *
 * No se actualiza la anterior: el Motor decidió con las cifras de un momento, y esa fila es la
 * evidencia de qué vio. `computed_at` ordena; la última es la vigente.
 *
 * ## Falla hacia «no disponible», nunca hacia arriba
 *
 * Quien llama (la verificación de identidad, el envío del alta) no puede depender de que esto
 * salga bien. Un error de lectura devuelve el resumen vacío con `disponible: false` y queda en el
 * log; el artefacto lo pondera como MENOS evidencia.
 */
@Injectable()
export class OnboardingBehaviorSummaryService {
  private readonly logger = new Logger(OnboardingBehaviorSummaryService.name);

  constructor(
    private readonly lectura: OnboardingBehaviorReadRepository,
    private readonly escritura: TelemetryBehaviorRepository,
  ) {}

  async calcular(tenantId: string, customerId: string, disparador: Disparador): Promise<ResumenDeComportamiento> {
    const ahora = new Date();
    try {
      const flow = await this.lectura.findLatestOnboardingFlow(tenantId, customerId);
      const flowId = flow ? String(flow.id) : null;
      const entradas = await this.lectura.entradasDelResumen(tenantId, customerId, flow);
      const resumen = calcularResumen(entradas);

      const fila = await this.escritura.createComputedSummary(
        {
          tenantId,
          customerId,
          onboardingFlowId: flowId,
          ...resumen,
          computedAt: ahora,
          disparador,
        },
        {},
      );
      return { ...resumen, onboardingFlowId: flowId, summaryId: String(fila.id), computedAt: ahora.toISOString(), disparador };
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo calcular el comportamiento del cliente ${customerId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      const vacio = calcularResumen({ pasos: [], campos: [], toques: [], permisos: [], abandonosPrevios: 0 });
      return { ...vacio, onboardingFlowId: null, summaryId: null, computedAt: ahora.toISOString(), disparador };
    }
  }

  /** El último resumen guardado, sin recalcular. Para pantallas de operaciones. */
  async ultimo(tenantId: string, customerId: string): Promise<ResumenDeComportamiento | null> {
    const fila = await this.lectura.findLatestSummary(tenantId, customerId);
    if (!fila) return null;
    const json = (fila.interScreenTimingJson ?? {}) as ResumenCalculado['interScreenTimingJson'];
    const disparador = (json as unknown as { disparador?: Disparador }).disparador ?? 'operations_read';
    return {
      completionTimeSeconds: fila.completionTimeSeconds,
      interScreenTimingJson: json,
      formErrorRate: fila.formErrorRate === null ? null : Number(fila.formErrorRate),
      ciCopyPasteDetected: fila.ciCopyPasteDetected,
      abandonmentCountPrior: fila.abandonmentCountPrior ?? 0,
      permissionGrantScore: fila.permissionGrantScore === null ? null : Number(fila.permissionGrantScore),
      botLikelihoodScore: fila.botLikelihoodScore === null ? null : Number(fila.botLikelihoodScore),
      computationVersion: fila.computationVersion ?? 'desconocida',
      disponible: fila.completionTimeSeconds !== null,
      onboardingFlowId: fila.onboardingFlowId,
      summaryId: String(fila.id),
      computedAt: (fila.computedAt ?? fila.createdAtValue).toISOString(),
      disparador,
    };
  }
}
