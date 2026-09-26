/**
 * @file Servicio de aplicación: aplica al expediente la decisión que tomó una persona.
 * @business Cierra el circuito de la revisión manual: lo que decide el analista llega al cliente.
 * @system traduce la resolución del caso del motor a estado de identidad, documento y evidencias.
 */
import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { CustomerLifecycleService } from '../../customers/application/customer-lifecycle.service.js';
import { CustomerVerificationRepository } from '../repositories/customer-verification.repository.js';
import { identityResultForRow } from '../../../common/utils/identity/identity-result.util.js';
import type { IdentityVerificationAttemptModel } from '../../../database/models/index.js';

export type ManualIdentityDecision = 'approved' | 'rejected';

type ReviewResolution = {
  tenantId: string;
  decision: ManualIdentityDecision;
  /*
   * El ID del usuario interno que decidió, no su correo: `manual_reviewed_by` y `reviewed_by` son
   * claves foráneas a `iam.internal_users`. Guardar ahí un correo rompe la fila y, peor, rompe la
   * trazabilidad: el día que esa persona cambie de correo, la auditoría deja de apuntar a nadie.
   */
  /**
   * Nulo cuando quien resolvio no es una persona de esta base —una resolucion que llega del motor
   * por clave de servicio, por ejemplo—. Es una FK a `internal_users`: inventar un id ahi rompe
   * la fila, y ponerle uno cualquiera rompe la trazabilidad, que es peor.
   */
  reviewedByInternalUserId: string | null;
  notes: string;
};

type ReviewOutcome = { customerId: string; identityResult: string; approvedEvidenceCount: number };

/**
 * La decisión humana tenía que volver al expediente, y no volvía.
 *
 * El recorrido estaba construido casi entero: el motor derivaba el caso a la cola de revisión, un
 * analista lo abría, lo resolvía y el caso quedaba `RESOLVED_APPROVED`. Ahí se acababa. El backend
 * —que es quien guarda el expediente del cliente— no se enteraba nunca: sus evidencias seguían en
 * `pending_review`, su documento sin verificar, y la cuenta atascada en `under_review` con los
 * bloqueadores `IDENTITY_NOT_VERIFIED` y `EVIDENCE_PENDING_REVIEW` puestos para siempre.
 *
 * Son dos sistemas con dos bases distintas: aprobar en uno no cambia nada en el otro. Esta pieza es
 * el puente que faltaba.
 *
 * ## Por qué reutiliza lo que ya había
 *
 * `resolveAttempt`, `resolveIdentityDocument` y `resolveReview` ya existían y ya los usaba la
 * resolución automática del proveedor. Lo que no existía era nadie que los llamara después de una
 * decisión HUMANA. Aquí se llaman igual, con una diferencia que importa: `reviewedBy` lleva quién
 * decidió, en vez del `null` que deja el proveedor. Una aprobación manual sin nombre detrás no se
 * puede auditar.
 *
 * ## Por qué el rechazo también se aplica
 *
 * Si sólo se propagara el sí, un rechazo dejaría el expediente exactamente igual que un caso sin
 * revisar: la persona esperando y el analista convencido de haberlo cerrado.
 */
@Injectable()
export class IdentityManualReviewOutcomeService {
  private readonly logger = new Logger(IdentityManualReviewOutcomeService.name);

  constructor(
    private readonly verificationRepository: CustomerVerificationRepository,
    private readonly lifecycleService: CustomerLifecycleService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * Aplica la decisión sobre EL intento que se revisó, no sobre «el último del cliente».
   *
   * El callback del Motor localiza el intento por el `executionId` de la ejecución y lo pasa aquí. Este
   * método antes ignoraba esa localización y volvía a buscar el último intento del cliente
   * (`findLatestAttempt`): con dos intentos abiertos —el del móvil ya verificado y otro que espera a
   * un analista— el veredicto caía sobre el que no era, y el revisado se quedaba esperando.
   */
  async apply(input: ReviewResolution & { attemptId: string }): Promise<ReviewOutcome> {
    const attempt = await this.verificationRepository.findAttemptById(input.tenantId, input.attemptId);
    if (!attempt) throw new NotFoundException('IDENTITY_ATTEMPT_NOT_FOUND');
    return this.applyToAttempt(attempt, input);
  }

  /**
   * Lo mismo, para quien aprueba o rechaza la identidad de un cliente sin decir qué intento.
   *
   * Resuelve el intento que ESPERA una decisión (`findAttemptAwaitingReview`), no el último a secas:
   * un `verified` posterior de otro canal no es lo que la persona está revisando.
   */
  async applyForCustomer(input: ReviewResolution & { customerId: string }): Promise<ReviewOutcome> {
    const attempt = await this.verificationRepository.findAttemptAwaitingReview(input.tenantId, input.customerId);
    if (!attempt) throw new NotFoundException('IDENTITY_ATTEMPT_NOT_FOUND');
    return this.applyToAttempt(attempt, input);
  }

  private async applyToAttempt(attempt: IdentityVerificationAttemptModel, input: ReviewResolution): Promise<ReviewOutcome> {
    // Un intento sin cliente —una verificación anónima del móvil, antes del alta— no tiene expediente
    // al que propagar nada: mejor decirlo que resolver documentos y evidencias de «null».
    if (!attempt.customerId) throw new UnprocessableEntityException('IDENTITY_ATTEMPT_WITHOUT_CUSTOMER');
    const customerId = String(attempt.customerId);

    const verified = input.decision === 'approved';
    const now = new Date();

    return this.sequelize.transaction(async (transaction) => {
      await this.verificationRepository.resolveAttempt(
        attempt,
        {
          // En el vocabulario de la fila: la del móvil se escribe en mayúsculas y la app la lee tal cual.
          finalResult: identityResultForRow(verified ? 'verified' : 'rejected', attempt.finalResult),
          // A diferencia de la resolución del proveedor, aquí SÍ hay una persona detrás.
          reviewedBy: input.reviewedByInternalUserId,
          notes: `Revisión manual · ${input.decision} · ${input.notes}`,
          now,
        },
        { transaction },
      );

      await this.verificationRepository.resolveIdentityDocument(
        input.tenantId,
        customerId,
        { verificationStatus: verified ? 'verified' : 'rejected', now },
        { transaction },
      );

      /*
       * Las evidencias se resuelven TODAS o ninguna: el analista mira el documento como un conjunto
       * —anverso, reverso y selfie cuentan la misma historia— y dejar una a medias bloquearía la
       * habilitación con un resto que nadie va a volver a mirar.
       */
      const pending = await this.verificationRepository.findPendingReviews(input.tenantId, customerId, {
        transaction,
      });
      for (const review of pending) {
        await this.verificationRepository.resolveReview(
          review,
          {
            reviewStatus: verified ? 'approved' : 'rejected',
            reviewedBy: input.reviewedByInternalUserId,
            rejectionReasonCode: verified ? null : 'MANUAL_REVIEW_REJECTED',
            notes: input.notes,
            now,
          },
          { transaction },
        );
      }

      /*
       * El avance del ciclo es de MEJOR ESFUERZO, igual que en el resto del alta: si la transición
       * no aplica —porque el expediente ya está en otro estado— el veredicto igualmente queda
       * guardado. Perder la decisión de un analista porque una transición no encajaba sería
       * pedirle que la vuelva a tomar.
       */
      await this.lifecycleService
        .advance({
          tenantId: input.tenantId,
          customerId,
          toStatus: verified ? 'active' : 'observed',
          reasonCode: verified ? 'identity_manual_review_approved' : 'identity_manual_review_rejected',
          changedByType: 'internal_user',
          changedByInternalUserId: input.reviewedByInternalUserId,
          notes: `Revisión manual de identidad: ${input.decision} por el usuario interno ${input.reviewedByInternalUserId}.`,
          transaction,
        })
        .catch(() => undefined);

      this.logger.log(
        `Revisión manual del cliente ${customerId}: ${input.decision} por el usuario interno ${input.reviewedByInternalUserId} · ${pending.length} evidencia(s).`,
      );

      return {
        customerId,
        identityResult: verified ? 'verified' : 'rejected',
        approvedEvidenceCount: pending.length,
      };
    });
  }
}
