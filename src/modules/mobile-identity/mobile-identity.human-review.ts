/**
 * @file Política de revisión humana del canal móvil, fuera del servicio que llama al Motor.
 * @business Sin corpus para calibrar la prueba de vida, el Motor sugiere y una persona decide.
 * @system traduce el veredicto del artefacto al estado del intento y abre el caso de la bandeja.
 */
import { Logger } from '@nestjs/common';
import { env } from '../../config/env.js';
import type { IdentityReviewCaseRepository } from '../customer-onboarding/repositories/identity-review-case.repository.js';
import type { IdentityVerificationState } from './mobile-identity.schemas.js';
import {
  IDENTITY_REVIEW_QUEUE,
  MOTIVO_REVISION_HUMANA_OBLIGATORIA,
  type OnboardingReviewDossierPublisher,
} from '../customer-onboarding/application/onboarding-review-dossier.publisher.js';

/** Cómo se traduce la decisión del artefacto al estado que el móvil entiende. */
const ESTADO_POR_DECISION: Readonly<Record<string, IdentityVerificationState>> = {
  VERIFICADO: 'VERIFIED',
  RECHAZADO: 'REJECTED',
  REVISION_HUMANA: 'IN_REVIEW',
};

export type DesenlaceDelMotor = {
  finalResult: IdentityVerificationState;
  /** Motivos del intento: el del artefacto y, si la política lo retiene, la sugerencia del Motor. */
  motivos: Record<string, unknown>;
  retenido: boolean;
  sugerencia: IdentityVerificationState;
};

/**
 * Un desenlace que el mapa no conoce va a revisión humana, no a aprobación: un artefacto puede añadir
 * una rama nueva y este código no tiene por qué enterarse para seguir siendo seguro.
 *
 * Con `IDENTITY_REQUIRE_HUMAN_REVIEW`, un VERIFICADO o un RECHAZADO no cierra la identidad: queda
 * IN_REVIEW con el veredicto como SUGERENCIA para el analista. Un REVISION_HUMANA ya está en la cola
 * del Motor y se resuelve allí; no se duplica en la de operaciones.
 */
export function desenlaceDelMotor(salida: Record<string, unknown>): DesenlaceDelMotor {
  const sugerencia = ESTADO_POR_DECISION[String(salida.identidad_resultado ?? '')] ?? 'IN_REVIEW';
  const reason = typeof salida.identidad_motivo === 'string' ? salida.identidad_motivo : null;
  const retenido = env.IDENTITY_REQUIRE_HUMAN_REVIEW && (sugerencia === 'VERIFIED' || sugerencia === 'REJECTED');
  return {
    finalResult: retenido ? 'IN_REVIEW' : sugerencia,
    motivos: retenido ? { reason, engineDecision: sugerencia, humanReviewPolicy: true } : { reason },
    retenido,
    sugerencia,
  };
}

const logger = new Logger('MobileIdentityHumanReview');

/**
 * El caso en la bandeja de operaciones. Sin él, un intento retenido por la política no lo vería nadie:
 * la cola del portal lista `manual_review_cases`, no intentos. Best-effort: si falla, el intento ya
 * quedó IN_REVIEW y el analista lo encuentra desde el expediente del cliente.
 */
export async function abrirCasoDeIdentidad(
  reviewCases: IdentityReviewCaseRepository,
  input: { tenantId: string; customerId: string | null; notes: string },
): Promise<void> {
  if (!input.customerId) return;
  try {
    await reviewCases.openIfAbsent({ tenantId: input.tenantId, customerId: input.customerId, notes: input.notes, now: new Date() });
  } catch (error: unknown) {
    logger.warn(
      `No se pudo abrir el caso de identidad del cliente ${input.customerId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Anexa el expediente del alta al caso del Motor, para que quien revise vea TODO lo que el teléfono
 * dejó (pedido de Pablo, 2026-09-28). Dos casos:
 *
 * - Retenido por la política (VERIFICADO/RECHAZADO → IN_REVIEW): el Motor DECIDIÓ y no abrió caso;
 *   se le pide abrirlo en la cola IDENTIDAD con el expediente. Al resolverse, el Motor llama a
 *   `/internal/identity/manual-review-callback` con esta ejecución.
 * - REVISION_HUMANA del Motor: el caso ya existe; el expediente se fusiona en él.
 *
 * Nunca lanza: el publicador registra el fallo y el intento sigue como quedó.
 */
export async function anexarExpedienteAlCaso(
  publisher: Pick<OnboardingReviewDossierPublisher, 'publish'>,
  input: {
    tenantId: string;
    customerId: string | null;
    executionId: string;
    desenlace: Pick<DesenlaceDelMotor, 'retenido' | 'sugerencia'>;
  },
): Promise<void> {
  if (!input.customerId) return;
  const base = { tenantId: input.tenantId, customerId: input.customerId, momento: 'identidad' as const, executionId: input.executionId };
  try {
    if (input.desenlace.retenido) {
      await publisher.publish({ ...base, openIfMissing: { queueCode: IDENTITY_REVIEW_QUEUE, motivo: MOTIVO_REVISION_HUMANA_OBLIGATORIA } });
    } else if (input.desenlace.sugerencia === 'IN_REVIEW') {
      await publisher.publish(base);
    }
  } catch (error: unknown) {
    logger.warn(
      `No se pudo anexar el expediente del alta a la ejecución ${input.executionId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
