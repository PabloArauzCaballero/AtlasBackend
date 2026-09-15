/**
 * @file Controlador HTTP: expone endpoints y delega la lógica a servicios.
 * @business Esta pieza cierra el circuito de la revisión humana de crédito hecha en el Motor.
 * @system recibe la resolución del Motor por clave compartida y la aplica a la solicitud por su ejecución.
 */
import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { assertEngineCallbackKey, ENGINE_CALLBACK_HEADER } from '../../common/utils/auth/engine-callback-key.util.js';
import { CreditDecisionService } from './application/credit-decision.service.js';

/**
 * `POST /internal/credit/manual-review-callback`: el Motor avisa cómo terminó la revisión.
 *
 * Es el gemelo del callback de identidad. El Motor abría su caso para una solicitud de crédito,
 * el analista lo resolvía allí, y aquí la solicitud seguía `under_review` sin nadie que la moviera.
 *
 * `@Public()` respecto al guard de SESIÓN: quien llama es un servicio, no una persona, y se
 * identifica con la clave compartida que el handler exige. Sin clave configurada responde 401.
 */
@Public()
@ApiExcludeController()
@Controller('internal/credit')
export class CreditReviewCallbackController {
  constructor(private readonly decisions: CreditDecisionService) {}

  @Post('manual-review-callback')
  @HttpCode(HttpStatus.OK)
  async aplicar(
    @CurrentTenant() tenantId: string,
    @Headers(ENGINE_CALLBACK_HEADER) clave: string | undefined,
    @Body() body: { executionId?: string; decision?: string; reason?: string; resolvedByInternalUserId?: string },
  ) {
    assertEngineCallbackKey(clave);

    const executionId = body.executionId?.trim();
    if (!executionId) throw new BadRequestException('Falta executionId.');
    if (body.decision !== 'APPROVE' && body.decision !== 'DECLINE') {
      // `CANCEL` retira el caso sin decidir: la solicitud se queda como está para que alguien la mire.
      return { applied: false, reason: 'DECISION_NO_APLICABLE' };
    }

    // Sólo una persona de ESTA base puede figurar como quien decidió (`decided_by` es FK).
    const revisadoPor = /^[1-9][0-9]*$/u.test(body.resolvedByInternalUserId ?? '') ? (body.resolvedByInternalUserId as string) : null;

    return this.decisions.applyEngineManualReview({
      tenantId,
      executionId,
      decision: body.decision,
      reason: body.reason ?? 'Resuelto en el Motor de Decisión.',
      resolvedByInternalUserId: revisadoPor,
    });
  }
}
