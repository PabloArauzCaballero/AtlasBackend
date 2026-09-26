/**
 * @file Variables de Twilio —SMS y su producto de correo, SendGrid— en su propio módulo.
 * @business Esta pieza reúne lo que hace falta para que un SMS llegue a un teléfono y un correo a su bandeja.
 * @system se separa de `env.schema.ts` para no engordar un archivo que ya roza el límite de tamaño.
 */
import { z } from 'zod';
import { optionalUrlEnvSchema } from './env.primitives.js';

export const twilioProviderEnvShape = {
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_SMS_FROM: z.string().optional(),

  /*
    El Messaging Service sustituye a `TWILIO_SMS_FROM` cuando está presente.

    Es la forma que Twilio recomienda: da pool de números, reintento del operador y remitente
    alfanumérico donde el país lo permite. Mandar los dos parámetros a la vez es un 400 de Twilio,
    así que el servicio gana (ver `twilioSender`).
  */
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),

  /*
    URL pública a la que Twilio avisa cómo terminó cada SMS.

    Sin ella el estado se queda en «enviado» para siempre: Twilio acepta el mensaje en milisegundos
    y sólo minutos después sabe si el operador lo entregó. Es además la URL que se firma, así que
    tiene que ser EXACTAMENTE la que se registró en Twilio (ver `computeTwilioSignature`).
  */
  TWILIO_STATUS_CALLBACK_URL: optionalUrlEnvSchema,

  TWILIO_WHATSAPP_FROM: z.string().optional(),

  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_FROM_EMAIL: z.string().optional(),
  SENDGRID_FROM_NAME: z.string().trim().max(80).optional(),
  SENDGRID_REPLY_TO_EMAIL: z.string().optional(),

  /*
    La llave pública (base64, DER) con la que SendGrid firma los eventos de entrega.

    Sin ella el endpoint de eventos queda CERRADO, no abierto: un webhook que acepta cualquier
    cuerpo deja que cualquiera marque un correo como rebotado y silencie a un cliente.
  */
  SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY: z.string().optional(),
} as const;
