/**
 * @file Servicio de aplicación: anexa el expediente del alta al caso de revisión del Motor.
 * @business El caso de identidad del alta que se abre en el portal del Motor lleva todo lo que el teléfono guardó; si el anexo falla, el alta sigue.
 * @system arma el expediente y lo manda por el puerto `ONBOARDING_DOSSIER_ENGINE_PORT` (lo implementa el cliente del Motor); nunca lanza.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import { isTerminalIdentityResult, LIVENESS_IDENTITY_CHANNEL } from '../../../common/utils/identity/identity-result.util.js';
import { IdentityVerificationAttemptModel } from '../../../database/models/index.js';
import { OnboardingReviewDossierService } from './onboarding-review-dossier.service.js';

/** Token del puerto: el onboarding no importa el módulo del Motor, lo recibe por inyección. */
export const ONBOARDING_DOSSIER_ENGINE_PORT = Symbol('ONBOARDING_DOSSIER_ENGINE_PORT');

/** Exactamente lo que admite el Motor (cualquier otro campo es 400). */
export type DossierOpenIfMissing = { queueCode?: string; priority?: number; slaMinutes?: number; motivo?: string };

export type DossierPutResult =
  | { ok: true; status: number; caseCode: string | null; created: boolean | null }
  | { ok: false; status: number | null; reason: string; final: boolean };

/** Lo único que el onboarding necesita del Motor aquí. `DecisionEngineClient.manualReviews` lo implementa. */
export interface OnboardingDossierEnginePort {
  putOnboardingDossier(
    executionId: string,
    body: { dossier: Record<string, unknown>; openIfMissing?: DossierOpenIfMissing },
  ): Promise<DossierPutResult>;
}

/** La cola del Motor donde se revisan las identidades del alta. */
export const IDENTITY_REVIEW_QUEUE = 'IDENTIDAD';
export const MOTIVO_REVISION_HUMANA_OBLIGATORIA = 'REVISION_HUMANA_OBLIGATORIA';
/** El Motor ya mandó el intento a una persona (REVISION_HUMANA); si el caso no existe, se abre con este motivo. */
export const MOTIVO_REVISION_DEL_MOTOR = 'REVISION_HUMANA_DEL_MOTOR';

export type DossierMilestone = 'identidad' | 'envio';

export type PublishInput = {
  tenantId: string;
  customerId: string;
  momento: DossierMilestone;
  /** La ejecución del Motor. Sin ella, la del último intento del canal móvil del cliente. */
  executionId?: string | null;
  openIfMissing?: DossierOpenIfMissing;
};

export type PublishOutcome = { sent: boolean; executionId: string | null; result: DossierPutResult | null; reason: string | null };

/**
 * «La evidencia se pierde, el alta no»: armar o mandar el expediente puede fallar (Motor caído, caso
 * que no existe, una tabla sin leer) y eso NO corta la verificación ni el envío del alta. Queda un
 * log estructurado (`evento: onboarding_dossier_*`) y se reintenta sólo en el siguiente hito.
 */
@Injectable()
export class OnboardingReviewDossierPublisher {
  private readonly logger = new Logger(OnboardingReviewDossierPublisher.name);

  constructor(
    private readonly dossiers: OnboardingReviewDossierService,
    @Inject(ONBOARDING_DOSSIER_ENGINE_PORT) private readonly engine: OnboardingDossierEnginePort,
    @InjectModel(IdentityVerificationAttemptModel) private readonly attempts: typeof IdentityVerificationAttemptModel,
  ) {}

  async publish(input: PublishInput): Promise<PublishOutcome> {
    try {
      const destino = input.executionId
        ? { executionId: input.executionId, openIfMissing: input.openIfMissing }
        : await this.destinoDelUltimoIntento(input.tenantId, input.customerId, input.openIfMissing);
      if (!destino.executionId) {
        this.registrar('onboarding_dossier_skipped', input, null, null, 'SIN_EJECUCION_DE_IDENTIDAD');
        return { sent: false, executionId: null, result: null, reason: 'SIN_EJECUCION_DE_IDENTIDAD' };
      }
      const dossier = await this.dossiers.build(input.tenantId, input.customerId);
      const result = await this.engine.putOnboardingDossier(destino.executionId, {
        dossier: dossier as unknown as Record<string, unknown>,
        ...(destino.openIfMissing ? { openIfMissing: destino.openIfMissing } : {}),
      });
      this.registrar(evento(result), input, destino.executionId, result, null);
      return { sent: result.ok, executionId: destino.executionId, result, reason: result.ok ? null : result.reason };
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      this.registrar('onboarding_dossier_failed', input, input.executionId ?? null, null, reason);
      return { sent: false, executionId: input.executionId ?? null, result: null, reason };
    }
  }

  /**
   * La ejecución del último intento del canal MÓVIL (selfie y carnet), que es la que abrió o abrirá
   * el caso del alta. Mientras ese intento espere una decisión, se pide abrir el caso si no existe
   * (cola IDENTIDAD): el anexo del paso de identidad pudo fallar, y sin caso el analista no ve nada.
   * Un intento ya resuelto (VERIFIED/REJECTED) sólo fusiona: no se abre un caso para lo decidido.
   */
  private async destinoDelUltimoIntento(
    tenantId: string,
    customerId: string,
    openIfMissing: DossierOpenIfMissing | undefined,
  ): Promise<{ executionId: string | null; openIfMissing?: DossierOpenIfMissing }> {
    const intento = await this.attempts.findOne({
      where: { tenantId, customerId, verificationChannel: LIVENESS_IDENTITY_CHANNEL },
      order: [['id', 'DESC']],
    } as FindOptions);
    const motivos = intento?.reasonCodesJson ?? {};
    const executionId = typeof motivos.executionId === 'string' && motivos.executionId ? motivos.executionId : null;
    const esperando = !isTerminalIdentityResult(intento?.finalResult);
    const abrir =
      openIfMissing ??
      (esperando
        ? {
            queueCode: IDENTITY_REVIEW_QUEUE,
            motivo: motivos.humanReviewPolicy === true ? MOTIVO_REVISION_HUMANA_OBLIGATORIA : MOTIVO_REVISION_DEL_MOTOR,
          }
        : undefined);
    return { executionId, ...(abrir ? { openIfMissing: abrir } : {}) };
  }

  private registrar(
    evento: string,
    input: PublishInput,
    executionId: string | null,
    result: DossierPutResult | null,
    reason: string | null,
  ): void {
    const linea = JSON.stringify({
      evento,
      tenantId: input.tenantId,
      customerId: input.customerId,
      momento: input.momento,
      executionId,
      status: result?.status ?? null,
      caseCode: result?.ok ? result.caseCode : null,
      created: result?.ok ? result.created : null,
      reason: reason ?? (result && !result.ok ? result.reason : null),
      final: result && !result.ok ? result.final : null,
    });
    // Un caso ya cerrado (409) es final y esperado: el analista decidió antes de que llegara el anexo.
    if (evento === 'onboarding_dossier_sent' || evento === 'onboarding_dossier_case_closed') this.logger.log(linea);
    else this.logger.warn(linea);
  }
}

function evento(result: DossierPutResult): string {
  if (result.ok) return 'onboarding_dossier_sent';
  return result.status === 409 ? 'onboarding_dossier_case_closed' : 'onboarding_dossier_rejected';
}
