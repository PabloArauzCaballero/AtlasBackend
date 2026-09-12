/**
 * @file Fachada de admisión de solicitudes de crédito (AT-026).
 * @business Es el punto donde toda la cadena anterior tiene que sostenerse: la elegibilidad se vuelve a
 *   evaluar aquí, en el servidor, antes de escribir nada, y la solicitud queda enlazada a la fila
 *   exacta de evaluación que la autorizó.
 * @system Desde AT-026 la decisión vive en `SubmitCreditApplicationUseCase` sobre puertos (unidad de
 *   trabajo, resolución de comercio, reloj). Esta clase compone el caso de uso con los adaptadores
 *   locales, traduce la denegación a HTTP FUERA de la transacción (AT-008) y conserva el contrato de
 *   respuesta anterior. `persistApplication` es la única entrada; los llamadores no cambian.
 */
import { ConflictException, Inject, Injectable, Optional } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { isApplicationError, toHttpException } from '../../../platform/contracts/application-error.js';
import { CLOCK, systemClock, type Clock } from '../../../platform/di/clock.js';
import { CreateCreditApplicationDto } from '../credit.schemas.js';
import { CREDIT_UNIT_OF_WORK, type CreditUnitOfWork } from './ports/credit-unit-of-work.port.js';
import { PARTNER_RESOLUTION_PORT, type PartnerResolutionPort } from './ports/partner-resolution.port.js';
import { SubmitCreditApplicationUseCase, denialError } from './use-cases/submit-credit-application.use-case.js';

export { denialError } from './use-cases/submit-credit-application.use-case.js';

@Injectable()
export class CreditApplicationAdmissionService {
  private readonly submit: SubmitCreditApplicationUseCase;

  constructor(
    @Inject(CREDIT_UNIT_OF_WORK) unitOfWork: CreditUnitOfWork,
    @Inject(PARTNER_RESOLUTION_PORT) partners: PartnerResolutionPort,
    @Optional() @Inject(CLOCK) clock: Clock = systemClock,
  ) {
    this.submit = new SubmitCreditApplicationUseCase(unitOfWork, partners, clock);
  }

  async persistApplication(input: {
    tenantId: string;
    customerId: string;
    body: CreateCreditApplicationDto;
    currentUser: AuthenticatedUser;
    idempotencyKey: string;
  }) {
    let outcome: Awaited<ReturnType<SubmitCreditApplicationUseCase['execute']>>;
    try {
      outcome = await this.submit.execute({
        tenantId: input.tenantId,
        customerId: input.customerId,
        body: input.body,
        actor: { role: input.currentUser.role, internalUserId: input.currentUser.internalUserId ?? null },
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error) {
      // El índice único parcial es la garantía real contra dos solicitudes vivas simultáneas: el
      // chequeo previo puede perder la carrera. Se traduce al mismo error de negocio para que el
      // cliente reciba siempre la misma respuesta, gane o pierda la carrera.
      if (error instanceof UniqueConstraintError) throw new ConflictException('CREDIT_APPLICATION_ALREADY_OPEN');
      // El caso de uso no conoce HTTP: sus errores de negocio se traducen aquí, en la frontera, a las
      // mismas excepciones (y mensajes) que antes lanzaba este servicio.
      if (isApplicationError(error)) throw toHttpException(error);
      throw error;
    }

    // Denegación prevista: la evidencia ya se confirmó con la transacción; aquí sólo se traduce (AT-008).
    if (!outcome.admitted) throw toHttpException(denialError(outcome.evaluation));

    // Mismo cuerpo que antes: `eligibilityEvaluationId` es interno y no sale al HTTP.
    const { eligibilityEvaluationId: _internal, ...response } = outcome.application;
    void _internal;
    return response;
  }
}
