/**
 * @file Controlador HTTP: correo saliente del ERP por el canal de ATLAS, firmado servicio a servicio.
 * @business La factura fiscal tiene que llegarle al comprador. El ERP la enviaba por SendGrid, que no está
 *   contratado, así que en TEST no salía nada. El correo de ATLAS es la Gmail API y vive aquí.
 * @system La entrega de la factura la hace un WORKER del ERP, sin sesión de nadie: esta ruta no pide JWT
 *   sino la firma HMAC del ERP sobre el cuerpo crudo (`x-atlas-signature`, el MISMO secreto que su outbox:
 *   `ERP_EVENTS_SIGNING_SECRET`). La ruta con sesión (`operations/notifications/internal-mail`) sigue para
 *   lo que manda una persona, como la propuesta.
 */
import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  HttpCode,
  HttpStatus,
  Injectable,
  Logger,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { env } from '../../config/env.js';
import { SIGNATURE_HEADER, verifyEventSignature } from '../../platform/security/signed-event.js';
import { GmailApiAdapter } from './adapters/gmail/gmail.adapter.js';
import { internalMailSchema, type InternalMailDto } from './internal-mail.schemas.js';
import { sendInternalMail } from './internal-mail.sender.js';

export const ERP_MAIL_PATH = 'internal/integration/erp/mail';

type RequestWithRawBody = { headers: Record<string, string | string[] | undefined>; rawBody?: Buffer };

/** Sólo el ERP, con su firma vigente: cerrado (503) si el secreto no está configurado, nunca abierto. */
@Injectable()
export class ErpMailSignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const secret = env.ERP_EVENTS_SIGNING_SECRET;
    if (!secret) throw new ServiceUnavailableException('SIGNED_EVENTS_NOT_CONFIGURED');
    const request = context.switchToHttp().getRequest<RequestWithRawBody>();
    if (!request.rawBody) throw new BadRequestException('RAW_JSON_BODY_REQUIRED');
    const header = request.headers[SIGNATURE_HEADER];
    const verdict = verifyEventSignature({
      secret,
      header: Array.isArray(header) ? header[0] : header,
      rawBody: request.rawBody.toString('utf8'),
      toleranceSeconds: env.ERP_EVENTS_SIGNATURE_TOLERANCE_SECONDS,
    });
    if (!verdict.ok) throw new UnauthorizedException(`SIGNATURE_${verdict.reason}`);
    return true;
  }
}

@Public()
@ApiExcludeController()
@UseGuards(ErpMailSignatureGuard)
@Controller('internal/integration/erp')
export class ErpMailController {
  private readonly logger = new Logger(ErpMailController.name);

  constructor(private readonly gmail: GmailApiAdapter) {}

  @Post('mail')
  @HttpCode(HttpStatus.OK)
  async send(
    @Body(new ZodValidationPipe(internalMailSchema)) body: InternalMailDto,
  ): Promise<{ provider: string; messageId: string | null }> {
    const sent = await sendInternalMail(this.gmail, body);
    // Sin el destinatario: un correo es dato personal y este log no es el sitio.
    this.logger.log(`Correo del ERP enviado (${body.reference}): ${sent.messageId ?? 'sin id'}.`);
    return sent;
  }
}
