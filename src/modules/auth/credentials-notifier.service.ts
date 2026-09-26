/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Entrega al responsable de una cuenta recién creada el correo con su contraseña temporal.
 * @system Puerta única del contexto identidad-acceso hacia el correo transaccional de credenciales.
 */
import { Injectable, Logger } from '@nestjs/common';
import { MailSenderService } from '../mail-sender/mail-sender.service.js';

export interface InitialCredentialsNotice {
  to: string;
  recipientName: string | null;
  temporaryPassword: string;
  /** Qué cuenta la origina, para trazar el envío: `internal-user:77`, `merchant-user:m7`. */
  reference: string;
  /** Portal al que da acceso la cuenta; ver `mail-product.ts`. */
  product?: string | undefined;
}

/**
 * Vive en `auth` y no en cada módulo que crea cuentas porque `auth` es el único del contexto con
 * permiso para hablar con `mail-sender` (excepción AT-040 de las fronteras). Los módulos que dan
 * de alta usuarios —internos y de comercio— ya dependen de `auth`; así el correo de credenciales
 * no abre una segunda puerta hacia mensajería.
 *
 * Nunca lanza: el alta y su auditoría ya quedaron escritas cuando se llama, y un correo que falla
 * no debe deshacerlas. El operador sigue viendo la contraseña en pantalla para entregarla por
 * otra vía, y el fallo queda en el log con la referencia de la cuenta.
 */
@Injectable()
export class CredentialsNotifierService {
  private readonly logger = new Logger(CredentialsNotifierService.name);

  constructor(private readonly mailSender: MailSenderService) {}

  async sendInitialCredentials(input: InitialCredentialsNotice): Promise<void> {
    try {
      await this.mailSender.sendInitialCredentials(input);
    } catch (error) {
      this.logger.error(
        `No se pudo enviar el correo de credenciales iniciales (${input.reference}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
