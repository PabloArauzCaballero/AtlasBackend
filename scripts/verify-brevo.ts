/**
 * Envío REAL de prueba por Brevo (SMS y WhatsApp), sin levantar la API.
 *
 * Existe por lo mismo que `verify-twilio.ts`: «compila y las pruebas pasan» no demuestra que la
 * clave valga, que el remitente esté habilitado, que la cuenta tenga crédito ni que la plantilla de
 * WhatsApp esté aprobada. Eso sólo lo dice un mensaje que llega. Usa los MISMOS adaptadores que el
 * backend en producción —no una llamada HTTP aparte— para que lo verificado sea lo que se ejecuta.
 *
 *   yarn verify:brevo --sms +59170000000
 *   yarn verify:brevo --whatsapp +59170000000
 *   yarn verify:brevo --sms +59170000000 --whatsapp +59170000000
 *
 * No imprime ninguna credencial: sólo qué proveedor está activo, el identificador que devolvió Brevo
 * y el motivo exacto si falló.
 */
import 'dotenv/config';
import { env } from '../src/config/env.js';
import { ResilientAdapterExecutorService } from '../src/common/resilience/resilient-adapter-executor.service.js';
import { NotificationProviderConfigService } from '../src/modules/notifications/adapters/notification-provider-config.service.js';
import { SmsNotificationAdapter } from '../src/modules/notifications/adapters/sms.adapter.js';
import { WhatsAppNotificationAdapter } from '../src/modules/notifications/adapters/whatsapp.adapter.js';
import { otpMessageBody, otpMessagePayload } from '../src/modules/notifications/otp-message.util.js';
import type { DeliveryResult, NotificationMessagePayload } from '../src/modules/notifications/notification-types.js';

function leerArgumento(nombre: string): string | null {
  const indice = process.argv.indexOf(`--${nombre}`);
  if (indice === -1) return null;
  const valor = process.argv[indice + 1];
  return valor && !valor.startsWith('--') ? valor : null;
}

/**
 * El mensaje de prueba imita al que más importa: el código de verificación del alta.
 *
 * Mandar un texto cualquiera verificaría la credencial y nada más. Con los mismos huecos de
 * plantilla que usa el OTP, lo que se comprueba es lo que hace falta comprobar: que la plantilla de
 * WhatsApp existe, está aprobada y sus parámetros se rellenan de verdad.
 */
function mensaje(canal: 'sms' | 'whatsapp', destino: string): NotificationMessagePayload {
  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  return {
    id: `verificacion-${Date.now()}`,
    tenantId: null,
    recipientType: 'system',
    recipientId: 'verificacion',
    channel: canal,
    subject: null,
    title: 'ATLAS',
    body: otpMessageBody(codigo, 10),
    payload: {
      ...otpMessagePayload(`verificacion-${Date.now()}`, codigo, 10),
      ...(canal === 'sms' ? { phone: destino } : { whatsappTo: destino }),
    },
    correlationId: null,
    deliveryTargets: [{ address: destino, kind: canal === 'sms' ? 'phone' : 'whatsapp' }],
  };
}

function reportar(canal: string, resultado: DeliveryResult): boolean {
  if (resultado.status === 'sent' || resultado.status === 'delivered') {
    console.log(`✅ ${canal}: aceptado por ${resultado.provider} (id del proveedor: ${resultado.providerMessageId ?? 'no devuelto'}).`);
    console.log('   Aceptado NO es entregado: el desenlace llega por el callback (BREVO_SMS_STATUS_CALLBACK_URL).');
    return true;
  }
  console.error(`❌ ${canal}: ${resultado.errorCode} — ${resultado.errorMessage}`);
  if (resultado.response) console.error(`   respuesta: ${JSON.stringify(resultado.response)}`);
  return false;
}

async function main(): Promise<void> {
  const telefono = leerArgumento('sms');
  const whatsapp = leerArgumento('whatsapp');
  if (!telefono && !whatsapp) {
    console.error('Uso: yarn verify:brevo --sms +59170000000 [--whatsapp +59170000000]');
    process.exit(2);
  }

  const config = new NotificationProviderConfigService();
  const executor = new ResilientAdapterExecutorService();
  console.log(`Proveedores activos — SMS: ${config.getSmsProvider()} · WhatsApp: ${config.getWhatsAppProvider()}`);
  console.log(`País por defecto para teléfonos sin prefijo: ${env.NOTIFICATION_DEFAULT_COUNTRY_CODE}`);

  let todoBien = true;

  if (telefono) {
    if (config.getSmsProvider() !== 'brevo') {
      console.error('❌ SMS: NOTIFICATION_SMS_PROVIDER no es `brevo`; no se envía nada.');
      todoBien = false;
    } else {
      const adapter = new SmsNotificationAdapter(config, executor);
      todoBien = reportar('SMS', await adapter.send(mensaje('sms', telefono))) && todoBien;
    }
  }

  if (whatsapp) {
    if (config.getWhatsAppProvider() !== 'brevo') {
      console.error('❌ WhatsApp: NOTIFICATION_WHATSAPP_PROVIDER no es `brevo`; no se envía nada.');
      todoBien = false;
    } else {
      const adapter = new WhatsAppNotificationAdapter(config, executor);
      todoBien = reportar('WhatsApp', await adapter.send(mensaje('whatsapp', whatsapp))) && todoBien;
    }
  }

  process.exit(todoBien ? 0 : 1);
}

void main();
