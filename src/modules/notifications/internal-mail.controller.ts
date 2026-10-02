/**
 * @file Correo saliente de los sistemas internos por el canal de ATLAS.
 * @business La propuesta comercial que prepara el ERP tiene que llegarle al comercio desde ATLAS, con su PDF.
 * @system el ERP reenvía la sesión de quien envía; aquí se manda por la misma Gmail API que ya usa ATLAS.
 */
import { Body, Controller, HttpCode, HttpStatus, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { zodToApiSchema } from '../../common/openapi/zod-to-schema.util.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { GmailApiAdapter } from './adapters/gmail/gmail.adapter.js';
import { internalMailSchema, type InternalMailDto } from './internal-mail.schemas.js';
import { sendInternalMail } from './internal-mail.sender.js';

/**
 * Hasta el 2026-09-30 el ERP intentaba mandar el correo por su cuenta, con SendGrid, que no está
 * contratado: la propuesta quedaba «enviada» sin que saliera nada. El correo de ATLAS es la Gmail API
 * (`NOTIFICATION_EMAIL_PROVIDER=gmail_api`), y vive aquí. El ERP arma el mensaje y el PDF y llama a
 * esta ruta con la sesión de quien envía: el correo sale de la misma cuenta que los códigos de acceso.
 *
 * Un destinatario por llamada: así nadie ve a quién más se le envió, y el desenlace es por persona.
 */
@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class InternalMailController {
  private readonly logger = new Logger(InternalMailController.name);

  constructor(private readonly gmail: GmailApiAdapter) {}

  @ApiOperation({ summary: 'Enviar un correo con adjuntos PDF por el canal de ATLAS (uso del ERP)' })
  @ApiBody({ schema: zodToApiSchema(internalMailSchema) })
  @ApiResponse({ status: 200, description: 'Gmail aceptó el mensaje; devuelve su id.' })
  @ApiResponse({ status: 503, description: 'MAIL_PROVIDER_NOT_CONFIGURED: el entorno no tiene Gmail como proveedor de correo.' })
  @Post('operations/notifications/internal-mail')
  @HttpCode(HttpStatus.OK)
  @Roles('internal_operator', 'admin', 'platform_admin', 'system_admin', 'system')
  async send(
    @Body(new ZodValidationPipe(internalMailSchema)) body: InternalMailDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ provider: string; messageId: string | null }> {
    const sent = await sendInternalMail(this.gmail, body);
    // Sin el destinatario: un correo es dato personal y este log no es el sitio.
    this.logger.log(`Correo interno enviado (${body.reference}) por ${user.sub}: ${sent.messageId ?? 'sin id'}.`);
    return sent;
  }
}
