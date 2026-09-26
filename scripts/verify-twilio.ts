/**
 * Envío REAL de prueba por Twilio (SMS) y por SendGrid (correo), sin levantar la API.
 *
 * Existe porque «el código compila y las pruebas pasan» no demuestra que una credencial sea válida,
 * que el remitente esté verificado ni que el número pueda escribir a Bolivia. Eso sólo lo dice un
 * envío que llega. Usa los MISMOS adaptadores que usa el backend en producción —no una llamada HTTP
 * aparte— para que lo que se verifique aquí sea exactamente lo que se ejecuta después.
 *
 *   yarn verify:twilio --sms +59170000000
 *   yarn verify:twilio --email alguien@dominio.bo
 *   yarn verify:twilio --sms +59170000000 --email alguien@dominio.bo
 *
 * No imprime ninguna credencial: sólo qué proveedor está activo, el identificador que devolvió y el
 * motivo exacto si falló.
 */
import 'dotenv/config';
import { env } from '../src/config/env.js';
import { ResilientAdapterExecutorService } from '../src/common/resilience/resilient-adapter-executor.service.js';
import { NotificationProviderConfigService } from '../src/modules/notifications/adapters/notification-provider-config.service.js';
import { SmsNotificationAdapter } from '../src/modules/notifications/adapters/sms.adapter.js';
import { EmailNotificationAdapter } from '../src/modules/notifications/adapters/email.adapter.js';
import type { GmailApiAdapter } from '../src/modules/notifications/adapters/gmail/gmail.adapter.js';
import type { DeliveryResult, NotificationMessagePayload } from '../src/modules/notifications/notification-types.js';

function leerArgumento(nombre: string): string | null {
  const indice = process.argv.indexOf(`--${nombre}`);
  if (indice === -1) return null;
  const valor = process.argv[indice + 1];
  return valor && !valor.startsWith('--') ? valor : null;
}

function mensaje(canal: 'sms' | 'email', payload: Record<string, unknown>): NotificationMessagePayload {
  return {
    id: `verificacion-${Date.now()}`,
    tenantId: null,
    recipientType: 'system',
    recipientId: 'verificacion',
    channel: canal,
    subject: 'ATLAS · prueba de envío',
    title: 'ATLAS',
    body: `Prueba de envío de ATLAS (${new Date().toISOString()}). Si recibes esto, el canal ${canal} funciona.`,
    payload,
    correlationId: null,
  };
}

function reportar(canal: string, resultado: DeliveryResult): boolean {
  if (resultado.status === 'sent' || resultado.status === 'delivered') {
    console.log(`✅ ${canal}: aceptado por ${resultado.provider} (id del proveedor: ${resultado.providerMessageId ?? 'no devuelto'}).`);
    return true;
  }
  console.error(`❌ ${canal}: ${resultado.errorCode} — ${resultado.errorMessage}`);
  if (resultado.response) console.error(`   respuesta: ${JSON.stringify(resultado.response)}`);
  return false;
}

async function main(): Promise<void> {
  const telefono = leerArgumento('sms');
  const correo = leerArgumento('email');
  if (!telefono && !correo) {
    console.error('Uso: yarn verify:twilio --sms +59170000000 [--email alguien@dominio.bo]');
    process.exit(2);
  }

  const config = new NotificationProviderConfigService();
  const executor = new ResilientAdapterExecutorService();
  console.log(`Proveedores activos — SMS: ${config.getSmsProvider()} · correo: ${config.getEmailProvider()}`);
  console.log(`País por defecto para teléfonos sin prefijo: ${env.NOTIFICATION_DEFAULT_COUNTRY_CODE}`);

  let todoBien = true;

  if (telefono) {
    if (config.getSmsProvider() !== 'twilio') {
      console.error('❌ SMS: NOTIFICATION_SMS_PROVIDER no es `twilio`; no se envía nada.');
      todoBien = false;
    } else {
      const adapter = new SmsNotificationAdapter(config, executor);
      todoBien = reportar('SMS', await adapter.send(mensaje('sms', { phone: telefono }))) && todoBien;
    }
  }

  if (correo) {
    if (config.getEmailProvider() !== 'sendgrid') {
      console.error('❌ Correo: NOTIFICATION_EMAIL_PROVIDER no es `sendgrid`; no se envía nada.');
      todoBien = false;
    } else {
      // Gmail vive en su propio adaptador y no se toca por este camino: se pasa un doble que grita
      // si alguien lo llama, en vez de montar el árbol de dependencias de OAuth para nada.
      const gmailNoUsado = {
        send: () => {
          throw new Error('El camino de Gmail no debería ejecutarse con NOTIFICATION_EMAIL_PROVIDER=sendgrid.');
        },
      } as unknown as GmailApiAdapter;
      const adapter = new EmailNotificationAdapter(config, executor, gmailNoUsado);
      const html = '<p>Prueba de envío de <strong>ATLAS</strong>. Si ves esto en negrita, el HTML también viaja.</p>';
      todoBien = reportar('Correo', await adapter.send(mensaje('email', { email: correo, html }))) && todoBien;
    }
  }

  if (!todoBien) process.exit(1);
  console.log('\nOjo: «aceptado» no es «entregado». El desenlace real llega por el callback de estado;');
  console.log('sin TWILIO_STATUS_CALLBACK_URL / SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY sólo sabrás que salió.');
}

void main().catch((error: unknown) => {
  console.error('❌ La verificación falló antes de poder enviar:', error instanceof Error ? error.message : error);
  process.exit(1);
});
