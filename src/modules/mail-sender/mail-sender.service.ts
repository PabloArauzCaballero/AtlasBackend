/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza entrega comunicaciones transaccionales indispensables para verificación y recuperación de acceso.
 * @system encapsula el cliente HTTP de correo y sus plantillas, timeouts y errores tipados.
 */
import { Injectable, Logger } from '@nestjs/common';
import { getRequestProduct } from '../../common/logging/request-context.js';
import { resolveProductName } from './mail-product.js';
import { isDeliverableAddress, logUndeliverable } from './mail-recipient.js';
import { GmailMailTransport } from './gmail-mail.transport.js';
import { WebhookMailTransport } from './webhook-mail.transport.js';
import { MailSenderClient, SendTemplateEmailInput } from './mail-sender.client.js';

const FALLBACK_RECIPIENT_NAME = 'Usuario ATLAS';

/**
 * Fachada de dominio del correo transaccional: expone los cuatro correos que ATLAS envía hoy
 * (código de reset de contraseña, PIN de login, verificación de contacto y credenciales iniciales)
 * sin que los módulos llamantes conozcan plantillas, transporte ni contrato HTTP.
 *
 * Conserva el nombre `MailSenderService` porque MailSender sigue siendo el canal PREFERENTE —el que
 * hospeda las plantillas, registra el envío y permite editarlas en caliente—, pero ya no es el
 * único: si no está configurado, el correo sale por el proveedor que el entorno haya elegido
 * (Gmail, o un webhook para los buzones de desarrollo). Antes esa ausencia apagaba en silencio el
 * segundo factor de los actores internos, y un despliegue con correo perfectamente sano se quedaba
 * con un solo factor.
 */
@Injectable()
export class MailSenderService {
  private readonly logger = new Logger(MailSenderService.name);

  constructor(
    private readonly client: MailSenderClient,
    private readonly gmail: GmailMailTransport,
    private readonly webhook: WebhookMailTransport,
  ) {}

  /** ¿Hay ALGÚN canal por el que entregar un correo transaccional? */
  isEnabled(): boolean {
    return this.client.isConfigured() || this.gmail.isConfigured() || this.webhook.isConfigured();
  }

  /**
   * Nombre del producto que irá en la cabecera del correo.
   *
   * Se prefiere lo que diga el llamante y, si no dice nada, lo que declaró la petición en curso por
   * `x-atlas-product`. Sin ninguno de los dos queda un rótulo genérico: antes era «Plataforma de
   * decisiones» fijo, así que un PIN pedido desde el ERP llegaba con el nombre del motor y quien lo
   * recibía no podía saber a qué portal se estaba entrando.
   */
  private productName(explicit: string | undefined): string {
    return resolveProductName(explicit ?? getRequestProduct()) ?? 'Plataforma corporativa';
  }

  /**
   * MailSender manda cuando está; los otros son suplentes, y son excluyentes entre sí.
   *
   * Antes de elegir transporte se descarta lo que no puede llegar. Una dirección de dominio
   * reservado (`@atlas.internal`, `@atlas.test`) la acepta el proveedor y la rebota después, y ese
   * rebote aterriza en el buzón real que firma los envíos. Se devuelve una referencia igual que un
   * envío normal —quien llama pidió avisar, no garantizar entrega, y ninguno de los caminos que
   * llegan aquí debe romperse porque una cuenta de semilla no tenga correo de verdad—.
   */
  private deliver(input: SendTemplateEmailInput): Promise<{ trackingId: string }> {
    if (!isDeliverableAddress(input.to)) {
      logUndeliverable(input.to, input.template);
      return Promise.resolve({ trackingId: input.reference });
    }
    if (this.client.isConfigured()) return this.despachar('mailsender', input, this.client.sendTemplateEmail(input));
    if (this.gmail.isConfigured()) return this.despachar('gmail_api', input, this.gmail.sendTemplateEmail(input));
    return this.despachar('webhook', input, this.webhook.sendTemplateEmail(input));
  }

  /**
   * Deja constancia de POR DÓNDE salió cada correo transaccional.
   *
   * Los tres transportes contestan igual y la operación que lo pidió no sabe cuál actuó, así que
   * «el código se envió» y «el código se entregó a un webhook de desarrollo» eran indistinguibles
   * en el log. Con un despliegue apuntando a `webhook`, todos los códigos de recuperación de un
   * entorno se van a un recolector y nadie recibe nada, sin un solo error.
   *
   * El dominio, nunca el buzón: el destinatario es dato personal.
   */
  private async despachar(
    transporte: string,
    input: SendTemplateEmailInput,
    envio: Promise<{ trackingId: string }>,
  ): Promise<{ trackingId: string }> {
    const dominio = input.to.slice(input.to.lastIndexOf('@') + 1);
    const enviado = await envio;
    this.logger.log(`Correo '${input.template}' entregado a '${transporte}' (dominio '${dominio}', referencia ${input.reference}).`);
    return enviado;
  }

  async sendPasswordResetCode(input: {
    to: string;
    recipientName: string | null;
    code: string;
    ttlMinutes: number;
    reference: string;
    /** Portal desde el que se pidió. Ver `mail-product.ts`. */
    product?: string | undefined;
  }): Promise<{ trackingId: string }> {
    return this.deliver({
      template: 'atlas-password-reset',
      to: input.to,
      recipientName: input.recipientName,
      sourceModule: 'auth',
      reference: input.reference,
      variables: {
        producto: this.productName(input.product),
        nombre: input.recipientName ?? FALLBACK_RECIPIENT_NAME,
        codigo: input.code,
        minutos: String(input.ttlMinutes),
      },
    });
  }

  /** Código de un solo uso del cambio de contraseña (actor ya autenticado). */
  async sendPasswordChangeCode(input: {
    to: string;
    recipientName: string | null;
    code: string;
    ttlMinutes: number;
    reference: string;
    /** Portal desde el que se pidió. Ver `mail-product.ts`. */
    product?: string | undefined;
  }): Promise<{ trackingId: string }> {
    return this.deliver({
      template: 'atlas-password-change',
      to: input.to,
      recipientName: input.recipientName,
      sourceModule: 'auth',
      reference: input.reference,
      variables: {
        producto: this.productName(input.product),
        nombre: input.recipientName ?? FALLBACK_RECIPIENT_NAME,
        codigo: input.code,
        minutos: String(input.ttlMinutes),
      },
    });
  }

  /** Código de verificación del correo declarado por un cliente durante el onboarding. */
  async sendContactVerificationCode(input: {
    to: string;
    code: string;
    ttlMinutes: number;
    reference: string;
    /** Portal desde el que se pidió. Ver `mail-product.ts`. */
    product?: string | undefined;
  }): Promise<{ trackingId: string }> {
    return this.deliver({
      template: 'atlas-verificacion-contacto',
      to: input.to,
      recipientName: null,
      sourceModule: 'customer-onboarding',
      reference: input.reference,
      variables: {
        codigo: input.code,
        minutos: String(input.ttlMinutes),
        producto: this.productName(input.product),
      },
    });
  }

  async sendLoginPin(input: {
    to: string;
    recipientName: string | null;
    pin: string;
    ttlMinutes: number;
    reference: string;
    /** Portal desde el que se pidió. Ver `mail-product.ts`. */
    product?: string | undefined;
  }): Promise<{ trackingId: string }> {
    return this.deliver({
      template: 'atlas-login-pin',
      to: input.to,
      recipientName: input.recipientName,
      sourceModule: 'auth',
      reference: input.reference,
      variables: {
        producto: this.productName(input.product),
        nombre: input.recipientName ?? FALLBACK_RECIPIENT_NAME,
        pin: input.pin,
        minutos: String(input.ttlMinutes),
      },
    });
  }

  async sendInitialCredentials(input: {
    to: string;
    recipientName: string | null;
    temporaryPassword: string;
    reference: string;
    /** Portal desde el que se pidió. Ver `mail-product.ts`. */
    product?: string | undefined;
  }): Promise<{ trackingId: string }> {
    return this.deliver({
      template: 'atlas-credenciales-iniciales',
      to: input.to,
      recipientName: input.recipientName,
      sourceModule: 'internal-users',
      reference: input.reference,
      variables: {
        producto: this.productName(input.product),
        nombre: input.recipientName ?? FALLBACK_RECIPIENT_NAME,
        email: input.to,
        password: input.temporaryPassword,
      },
    });
  }
}
