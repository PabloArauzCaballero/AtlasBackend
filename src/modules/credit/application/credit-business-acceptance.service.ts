/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza deja que el negocio acepte o declare no querer una operación que el motor ya aprobó.
 * @system aplica la aceptación comercial sobre una solicitud aprobada por el motor de decisión.
 */
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { CreditRepository } from '../credit.repository.js';
import { CreditBusinessAcceptanceDto } from '../credit.schemas.js';

/**
 * La segunda pregunta, que no es la del motor.
 *
 * El motor responde «¿este solicitante cumple los criterios de riesgo?». El negocio responde
 * «¿queremos esta operación ahora?», y eso depende de cosas que el motor no mira: el cupo del mes,
 * la concentración en un comercio, la liquidez, una campaña que se cerró ayer.
 *
 * Hasta aquí la segunda no se hacía. El motor aprobaba, la solicitud quedaba en `approved` —que
 * está en `CLOSED_STATUSES`— y el endpoint de decisión manual respondía
 * `CREDIT_APPLICATION_ALREADY_DECIDED`. El motor no proponía: disponía.
 *
 * **Declinar aquí no contradice al motor ni lo corrige.** Son dos juicios sobre cosas distintas, y
 * por eso la aceptación vive en su propia columna y no reescribe `decision_reason_code`: mezclarlas
 * haría imposible medir al motor —sus aprobaciones declinadas por cupo contarían como errores
 * suyos— y esa medición es lo que permite calibrarlo.
 */
@Injectable()
export class CreditBusinessAcceptanceService {
  private readonly logger = new Logger(CreditBusinessAcceptanceService.name);

  constructor(
    private readonly credit: CreditRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async decide(input: { tenantId: string; applicationId: string; body: CreditBusinessAcceptanceDto; currentUser: AuthenticatedUser }) {
    return this.sequelize.transaction(async (transaction) => {
      const application = await this.credit.findApplicationById(input.tenantId, input.applicationId, { transaction });
      if (!application) throw new NotFoundException('CREDIT_APPLICATION_NOT_FOUND');

      /*
       * Sólo lo que el motor aprobó y sigue esperando. Una solicitud que ya se aceptó —o que se
       * declinó— no se vuelve a decidir: sin esta puerta, aceptar dos veces produciría dos
       * desembolsos sobre la misma aprobación.
       */
      if (application.businessAcceptance !== 'pending') {
        throw new ConflictException(
          `CREDIT_BUSINESS_ACCEPTANCE_NOT_PENDING: la solicitud está en ${application.businessAcceptance ?? 'sin aceptación aplicable'}.`,
        );
      }

      const previousStatus = application.status;
      const accepted = input.body.accepted;
      const now = new Date();

      Object.assign(application, {
        businessAcceptance: accepted ? 'accepted' : 'declined',
        businessAcceptanceAt: now,
        businessAcceptanceBy: input.currentUser.sub,
        businessAcceptanceReasonCode: input.body.reasonCode ?? null,
        businessAcceptanceNotes: input.body.notes ?? null,
        /*
         * Declinar mueve el estado a `rejected`: para el solicitante el desenlace es el mismo —no
         * hay crédito— y dejarlo en `approved` publicaría una aprobación que nadie va a honrar.
         * Lo que distingue este rechazo del que dictó el motor queda en la columna de aceptación,
         * que es donde se puede leer sin contaminar la medición del modelo.
         */
        ...(accepted ? {} : { status: 'rejected' }),
        updatedAtValue: now,
      });
      await application.save({ transaction });

      await this.credit.createApplicationEvent(
        {
          tenantId: input.tenantId,
          creditApplicationId: input.applicationId,
          eventType: 'business_acceptance_recorded',
          previousStatus,
          newStatus: application.status,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          reasonCode: input.body.reasonCode ?? null,
          payloadJson: {
            accepted,
            // Se conserva qué había decidido el motor: es lo que permite después separar «el
            // modelo se equivocó» de «el negocio no quiso», que son dos conversaciones distintas.
            engineDecisionMode: application.decisionMode,
            engineExecutionId: application.decisionExecutionId,
          },
          notes: input.body.notes ?? null,
          happenedAt: now,
        },
        { transaction },
      );

      this.logger.log(
        `Aceptación de negocio registrada: solicitud=${input.applicationId} ` +
          `resultado=${accepted ? 'accepted' : 'declined'} actor=${input.currentUser.sub}`,
      );

      return {
        applicationId: input.applicationId,
        status: application.status,
        businessAcceptance: application.businessAcceptance,
        businessAcceptanceAt: now.toISOString(),
      };
    });
  }
}
