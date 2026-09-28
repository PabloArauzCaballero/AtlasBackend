/**
 * @file Controlador HTTP: expone endpoints y delega la lógica a servicios.
 * @business Esta pieza cierra el extracto que una persona revisó en el Motor, para que el cliente no quede bloqueado.
 * @system recibe el aviso del Motor por clave compartida y relee la ejecución con la llave de Atlas antes de aplicar nada.
 */
import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { EngineCallbackKeyGuard } from '../../common/guards/engine-callback-key.guard.js';
import { BankStatementHumanReviewSync } from './application/bank-statement-human-review.sync.js';

/**
 * `POST /internal/credit/bank-statement-review-callback`: el Motor avisa de que una persona resolvió
 * un extracto en su bandeja.
 *
 * Es el gemelo de los callbacks de revisión manual, con una diferencia a propósito: el aviso NO
 * trae la decisión que se aplica. Trae la referencia de la ejecución (`requestId`) y aquí se vuelve a
 * leer en el Motor con la llave de Atlas; lo que se aplica es lo que responde esa lectura. Así el
 * aviso sólo puede adelantar un cierre que el barrido del job haría igual, nunca inventarlo.
 *
 * Sin sesión y con credencial de servicio: quien llama es el Motor. Sin clave configurada, 401.
 */
@Public()
@UseGuards(EngineCallbackKeyGuard)
@ApiExcludeController()
@Controller('internal/credit')
export class BankStatementReviewCallbackController {
  constructor(private readonly humanReviews: BankStatementHumanReviewSync) {}

  @Post('bank-statement-review-callback')
  @HttpCode(HttpStatus.OK)
  async aplicar(@CurrentTenant() tenantId: string, @Body() body: { requestId?: string; resolvedByInternalUserId?: string }) {
    const requestId = body.requestId?.trim();
    if (!requestId) throw new BadRequestException('Falta requestId.');

    // Sólo una persona de ESTA base puede figurar como quien revisó (`reviewed_by_internal_user_id` es FK).
    const revisadoPor = /^[1-9][0-9]*$/u.test(body.resolvedByInternalUserId ?? '') ? (body.resolvedByInternalUserId as string) : null;

    return this.humanReviews.syncByEngineRequest({ tenantId, requestId, resolvedByInternalUserId: revisadoPor });
  }
}
