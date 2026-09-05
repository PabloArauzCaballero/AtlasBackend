/**
 * @file Servicio de aplicación: aplica al expediente la decisión que tomó una persona.
 * @business Cierra el circuito de la revisión manual: lo que decide el analista llega al cliente.
 * @system traduce la resolución del caso del motor a estado de identidad, documento y evidencias.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { CustomerLifecycleService } from '../../customers/application/customer-lifecycle.service.js';
import { CustomerVerificationRepository } from '../repositories/customer-verification.repository.js';

export type ManualIdentityDecision = 'approved' | 'rejected';

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

  async apply(input: {
    tenantId: string;
    customerId: string;
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
  }): Promise<{ customerId: string; identityResult: string; approvedEvidenceCount: number }> {
    const attempt = await this.verificationRepository.findLatestAttempt(input.tenantId, input.customerId);
    if (!attempt) throw new NotFoundException('IDENTITY_ATTEMPT_NOT_FOUND');

    const verified = input.decision === 'approved';
    const now = new Date();

    return this.sequelize.transaction(async (transaction) => {
      await this.verificationRepository.resolveAttempt(
        attempt,
        {
          finalResult: verified ? 'verified' : 'rejected',
          // A diferencia de la resolución del proveedor, aquí SÍ hay una persona detrás.
          reviewedBy: input.reviewedByInternalUserId,
          notes: `Revisión manual · ${input.decision} · ${input.notes}`,
          now,
        },
        { transaction },
      );

      await this.verificationRepository.resolveIdentityDocument(
        input.tenantId,
        input.customerId,
        { verificationStatus: verified ? 'verified' : 'rejected', now },
        { transaction },
      );

      /*
       * Las evidencias se resuelven TODAS o ninguna: el analista mira el documento como un conjunto
       * —anverso, reverso y selfie cuentan la misma historia— y dejar una a medias bloquearía la
       * habilitación con un resto que nadie va a volver a mirar.
       */
      const pending = await this.verificationRepository.findPendingReviews(input.tenantId, input.customerId, {
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
          customerId: input.customerId,
          toStatus: verified ? 'active' : 'observed',
          reasonCode: verified ? 'identity_manual_review_approved' : 'identity_manual_review_rejected',
          changedByType: 'internal_user',
          changedByInternalUserId: input.reviewedByInternalUserId,
          notes: `Revisión manual de identidad: ${input.decision} por el usuario interno ${input.reviewedByInternalUserId}.`,
          transaction,
        })
        .catch(() => undefined);

      this.logger.log(
        `Revisión manual del cliente ${input.customerId}: ${input.decision} por el usuario interno ${input.reviewedByInternalUserId} · ${pending.length} evidencia(s).`,
      );

      return {
        customerId: input.customerId,
        identityResult: verified ? 'verified' : 'rejected',
        approvedEvidenceCount: pending.length,
      };
    });
  }
}
