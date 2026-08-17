/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza permite verificar de verdad el segundo factor en entornos de prueba, sin apagarlo.
 * @system entrega el correo transaccional como JSON a un webhook, para buzones de desarrollo.
 */
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ResilientAdapterExecutorService } from '../../common/resilience/resilient-adapter-executor.service.js';
import { postJson } from '../notifications/adapters/http-adapter.util.js';
import { NotificationProviderConfigService } from '../notifications/adapters/notification-provider-config.service.js';
import { renderMailTemplate } from './mail-template-render.js';
import { SendTemplateEmailInput } from './mail-sender.client.js';

const PROVIDER = 'webhook_email';

/**
 * Tercer transporte: el correo se entrega como JSON a una URL. Existe para PROBAR el segundo
 * factor, no para renunciar a él.
 *
 * Una batería automatizada que entra por la pantalla de acceso no puede leer un buzón real, y la
 * salida fácil —apagar `AUTH_LOGIN_PIN_ENABLED` durante las pruebas— deja la corrida en verde
 * habiendo ejercitado un camino de acceso que no es el que corre en producción: justo el tramo que
 * más importa comprobar. Con un recolector local escuchando en esta URL, la prueba lee el PIN por
 * donde de verdad sale y completa los DOS pasos.
 *
 * Deliberadamente NO cuenta como canal válido en producción (`env-cross-checks.ts` sigue exigiendo
 * MailSender o Gmail): un webhook es la forma que tiene el recolector de desarrollo, y admitirlo
 * allí permitiría desviar los segundos factores de todo un despliegue a un buzón cualquiera.
 */
@Injectable()
export class WebhookMailTransport {
  constructor(
    private readonly config: NotificationProviderConfigService,
    private readonly executor: ResilientAdapterExecutorService,
  ) {}

  isConfigured(): boolean {
    return this.config.getEmailProvider() === 'webhook' && Boolean(this.config.getWebhookUrl('email'));
  }

  async sendTemplateEmail(input: SendTemplateEmailInput): Promise<{ trackingId: string }> {
    const url = this.config.getWebhookUrl('email');
    if (!this.isConfigured() || !url) {
      throw new ServiceUnavailableException('El canal de correo por webhook no está configurado.');
    }

    const rendered = renderMailTemplate(input.template, { ...input.variables });
    const response = await postJson(
      this.executor,
      PROVIDER,
      url,
      {},
      {
        channel: 'email',
        to: input.to,
        subject: rendered.subject,
        body: rendered.text,
        html: rendered.html,
        template: input.template,
        sourceModule: input.sourceModule,
        messageId: input.reference,
      },
    );

    if (!response.ok) {
      throw new ServiceUnavailableException(`El webhook de correo respondió HTTP ${response.status}.`);
    }
    const id = response.json.id ?? response.json.messageId;
    return { trackingId: typeof id === 'string' ? id : input.reference };
  }
}
