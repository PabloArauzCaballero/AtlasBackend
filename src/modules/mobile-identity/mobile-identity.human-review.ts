/**
 * @file Política de revisión humana del canal móvil, fuera del servicio que llama al Motor.
 * @business Sin corpus para calibrar la prueba de vida, el Motor sugiere y una persona decide.
 * @system traduce el veredicto del artefacto al estado del intento y abre el caso de la bandeja.
 */
import { Logger } from '@nestjs/common';
import { env } from '../../config/env.js';
import type { IdentityReviewCaseRepository } from '../customer-onboarding/repositories/identity-review-case.repository.js';
import type { IdentityVerificationState } from './mobile-identity.schemas.js';

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
