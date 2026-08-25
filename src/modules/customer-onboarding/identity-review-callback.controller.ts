/**
 * @file Adaptador HTTP: la vuelta del motor de decision cuando un analista resuelve una revision.
 * @business Cierra el circuito: aprobar la identidad en el motor deja al cliente verificado aqui.
 * @system autenticado con una clave compartida, no con sesion: quien llama es un servicio.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { env } from '../../config/env.js';
import { tenantIdFromHeader } from '../../common/utils/http/headers.util.js';
import { IdentityManualReviewOutcomeService } from './application/identity-manual-review-outcome.service.js';
import { CustomerVerificationRepository } from './repositories/customer-verification.repository.js';

/** La cabecera con la que el motor se identifica. */
const CLAVE_HEADER = 'x-engine-callback-key';

/**
 * La resolucion de una revision manual, de vuelta desde el motor.
 *
 * Existe porque hasta ahora no volvia. El analista aprobaba la identidad en el motor, el caso
 * quedaba `RESOLVED_APPROVED` alli, y aqui el intento seguia `IN_REVIEW` para siempre: el cliente
 * no podia pedir credito y nada avisaba de que faltaba un paso. Aplicar el resultado exigia que
 * alguien llamase a mano a otro endpoint, cosa que nadie hace porque nadie sabe que hay que hacerla.
 *
 * El motor no sabe de que CLIENTE es el caso —no tiene por que saberlo—, solo de que ejecucion. El
 * puente es `executionId`, que este lado guarda en el intento al pedirle la decision.
 *
 * Se autentica con clave compartida y no con sesion a proposito: quien llama es un servicio, no una
 * persona. Sin clave configurada el endpoint responde 401 en vez de quedar abierto: un circuito de
 * identidad que se puede cerrar sin credencial es peor que uno que no se cierra.
 */
@ApiExcludeController()
@Controller('internal/identity')
export class IdentityReviewCallbackController {
  constructor(
    private readonly outcome: IdentityManualReviewOutcomeService,
    private readonly verifications: CustomerVerificationRepository,
  ) {}

  @Post('manual-review-callback')
  @HttpCode(HttpStatus.OK)
  async aplicar(
    @Headers('x-tenant-id') tenantIdHeader: string | undefined,
    @Headers(CLAVE_HEADER) clave: string | undefined,
    @Body()
    body: {
      executionId?: string;
      decision?: string;
      reason?: string;
      resolvedByInternalUserId?: string;
    },
  ) {
    const esperada = env.ENGINE_CALLBACK_API_KEY;
    if (!esperada || !clave || clave !== esperada) {
      throw new UnauthorizedException('Credencial de servicio invalida.');
    }

    const tenantId = tenantIdFromHeader(tenantIdHeader);
    const executionId = body.executionId?.trim();
    if (!executionId) throw new BadRequestException('Falta executionId.');
    if (body.decision !== 'APPROVE' && body.decision !== 'DECLINE') {
      /*
       * `CANCEL` no es una decision sobre la identidad: el caso se retira sin resolverla, y el
       * intento tiene que quedarse como esta para que alguien vuelva a mirarlo.
       */
      return { applied: false, reason: 'DECISION_NO_APLICABLE' };
    }

    const attempt = await this.verifications.findAttemptByExecutionId(tenantId, executionId);
    if (!attempt) {
      throw new NotFoundException(`Ningun intento de identidad nacio de la ejecucion ${executionId}.`);
    }

    /*
     * Quien resolvio, SOLO si es una persona de esta base.
     *
     * El motor manda su principal, y ese principal no siempre es un usuario: cuando la resolucion
     * llega por clave de gestion vale `bootstrap-management`, que es texto. `reviewed_by` es un
     * bigint con FK a `internal_users`, asi que meterlo tal cual reventaba el callback entero con
     * «invalid input syntax for type bigint» y la identidad se quedaba sin aplicar —el mismo tipo
     * de fallo que este circuito existe para evitar—.
     *
     * Sin id numerico se guarda `null`: es preferible no saber quien fue a inventar una referencia
     * que no apunta a nadie.
     */
    const revisadoPor = /^[1-9][0-9]*$/u.test(body.resolvedByInternalUserId ?? '')
      ? (body.resolvedByInternalUserId as string)
      : null;

    return this.outcome.apply({
      tenantId,
      customerId: String(attempt.customerId),
      decision: body.decision === 'APPROVE' ? 'approved' : 'rejected',
      reviewedByInternalUserId: revisadoPor,
      notes: body.reason ?? 'Resuelto en el motor de decision.',
    });
  }
}
