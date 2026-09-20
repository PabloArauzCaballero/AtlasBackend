/**
 * @file Controlador HTTP: expone endpoints y delega la lógica a servicios.
 * @business Esta pieza recibe de Twilio y de SendGrid el desenlace de cada envío y lo deja registrado.
 * @system verifica la firma del proveedor antes de tocar nada y contesta 2xx aunque el aviso no aplique.
 */
import { Body, Controller, Headers, HttpCode, HttpStatus, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { NotificationProviderConfigService } from './adapters/notification-provider-config.service.js';
import { isValidTwilioSignature } from './adapters/twilio/twilio-signature.util.js';
import {
  isValidSendGridSignature,
  SENDGRID_SIGNATURE_HEADER,
  SENDGRID_TIMESTAMP_HEADER,
} from './adapters/sendgrid/sendgrid-signature.util.js';
import { NotificationProviderCallbacksService } from './notification-provider-callbacks.service.js';

/**
 * El tope de peticiones de estos dos endpoints NO puede ser el general.
 *
 * Una campaña de 10.000 SMS genera un aviso de estado por mensaje —a veces dos— en pocos minutos, y
 * todos llegan desde las IP del proveedor. Con el tope general (100/min) el propio éxito de la
 * campaña provoca 429, el proveedor reintenta, vuelve a chocar y acaba descartando avisos: el
 * resultado sería una tabla de entregas que empeora cuanto más se usa el canal.
 */
const WEBHOOK_RATE_LIMIT = { default: { limit: 6_000, ttl: 60_000 } };

/**
 * Callbacks de los proveedores de Twilio: estado de SMS y eventos de correo de SendGrid.
 *
 * `@Public()` respecto al guard de SESIÓN, igual que los callbacks del Motor: quien llama es un
 * proveedor externo, no una persona con token. Lo que lo protege es la FIRMA, y sin secreto
 * configurado el endpoint responde 401 en vez de quedar abierto —un webhook de entregas que acepta
 * cualquier cuerpo deja que un tercero marque como rebotado el correo de un cliente y lo silencie—.
 */
@Public()
@ApiExcludeController()
@Controller('internal/notifications')
export class NotificationProviderCallbacksController {
  constructor(
    private readonly callbacks: NotificationProviderCallbacksService,
    private readonly config: NotificationProviderConfigService,
  ) {}

  /**
   * `POST /internal/notifications/twilio-status`: Twilio avisa cómo terminó un mensaje.
   *
   * La URL que se firma es la CONFIGURADA, no la reconstruida a partir de la petición: detrás de un
   * proxy que termina TLS, `req.protocol` dice `http` mientras Twilio firmó `https`, y la
   * verificación fallaría siempre sin que el log dijera por qué.
   */
  @Post('twilio-status')
  @HttpCode(HttpStatus.OK)
  @Throttle(WEBHOOK_RATE_LIMIT)
  async twilioStatus(
    @Headers('x-twilio-signature') firma: string | undefined,
    @Body() body: Record<string, string>,
  ): Promise<{ applied: boolean; reason: string }> {
    const authToken = this.config.getTwilioAuthToken();
    const url = this.config.getTwilioStatusCallbackUrl();
    if (!authToken || !url) throw new UnauthorizedException('CALLBACK_TWILIO_NO_CONFIGURADO');
    if (!isValidTwilioSignature({ authToken, url, params: body ?? {}, signature: firma })) {
      throw new UnauthorizedException('FIRMA_TWILIO_INVALIDA');
    }
    return this.callbacks.applyTwilioStatus(body ?? {});
  }

  /**
   * `POST /internal/notifications/sendgrid-events`: SendGrid entrega un lote de eventos.
   *
   * Se verifica sobre `req.rawBody` —los bytes tal cual llegaron— porque la firma se calculó sobre
   * ellos: verificar sobre el JSON re-serializado no cuadra nunca (basta un espacio distinto).
   */
  @Post('sendgrid-events')
  @HttpCode(HttpStatus.OK)
  @Throttle(WEBHOOK_RATE_LIMIT)
  async sendGridEvents(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers(SENDGRID_SIGNATURE_HEADER) firma: string | undefined,
    @Headers(SENDGRID_TIMESTAMP_HEADER) timestamp: string | undefined,
    @Body() body: unknown,
  ): Promise<{ received: number; applied: number }> {
    const publicKey = this.config.getSendGridEventPublicKey();
    if (!publicKey) throw new UnauthorizedException('CALLBACK_SENDGRID_NO_CONFIGURADO');
    const rawBody = request.rawBody;
    if (!rawBody) throw new UnauthorizedException('CUERPO_CRUDO_NO_DISPONIBLE');
    if (!isValidSendGridSignature({ publicKey, signature: firma, timestamp, rawBody })) {
      throw new UnauthorizedException('FIRMA_SENDGRID_INVALIDA');
    }
    return this.callbacks.applySendGridEvents(Array.isArray(body) ? body : []);
  }
}
