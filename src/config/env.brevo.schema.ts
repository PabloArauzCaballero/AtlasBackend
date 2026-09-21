/**
 * @file Variables de Brevo —SMS y WhatsApp— en su propio módulo.
 * @business Esta pieza reúne lo que hace falta para que un SMS y un WhatsApp de ATLAS lleguen a un teléfono.
 * @system se separa de `env.schema.ts` por la misma razón que el bloque de Twilio: ese archivo ya roza el gate de tamaño.
 */
import { z } from 'zod';
import { optionalNonEmptyStringEnvSchema, optionalUrlEnvSchema } from './env.primitives.js';

/**
 * Una cadena vacía es «sin configurar», no «valor inválido».
 *
 * Hace falta aquí y no en el bloque de Twilio porque estas variables SÍ tienen forma exigida (el
 * remitente de Brevo tiene tope de longitud, el secreto tiene mínimo): sin esto, una plantilla con
 * `BREVO_SMS_SENDER=` sin rellenar no sería «falta un secreto» sino «remitente inválido», que es un
 * error que habla de otra cosa y manda a quien despliega a buscar el problema equivocado.
 */
function vacioEsAusente(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

export const brevoProviderEnvShape = {
  /** Una sola clave para los dos canales: Brevo autentica todo con la cabecera `api-key`. */
  BREVO_API_KEY: optionalNonEmptyStringEnvSchema,

  /*
    El remitente que ve el teléfono. Brevo impone el límite: 11 caracteres alfanuméricos (remitente
    con nombre, p. ej. `ATLAS`) o 15 numéricos (un número). Se valida aquí y no al enviar porque un
    remitente de 12 letras es un 400 en CADA mensaje, y ese 400 llega cuando ya hay una campaña en
    curso; el arranque es el único momento en que el error sale gratis.

    Bolivia no admite remitente alfanumérico en todos los operadores: si los SMS no llegan pero
    Brevo los acepta, esto es lo primero que se cambia (ver el plan de Brevo).
  */
  BREVO_SMS_SENDER: z.preprocess(
    vacioEsAusente,
    z
      .string()
      .trim()
      .refine(
        (value) => (/^[0-9]+$/u.test(value) ? value.length <= 15 : /^[A-Za-z0-9 ]+$/u.test(value) && value.length <= 11),
        'Debe ser hasta 11 caracteres alfanuméricos o hasta 15 numéricos (límite de Brevo).',
      )
      .optional(),
  ),

  /*
    URL pública a la que Brevo avisa cómo terminó cada SMS (campo `webUrl` del envío).

    Va por mensaje y no por cuenta a propósito: es el equivalente exacto de `StatusCallback` de
    Twilio, no hay que registrar nada en el panel y el mismo despliegue puede apuntar a su propio
    entorno sin pisarse con otro. Sin ella el estado se queda en «enviado» para siempre.

    Tiene que terminar en el secreto: `.../internal/notifications/brevo-sms-events/<BREVO_WEBHOOK_SECRET>`.
  */
  BREVO_SMS_STATUS_CALLBACK_URL: optionalUrlEnvSchema,

  /*
    El secreto que viaja en la URL del callback.

    Brevo NO firma sus webhooks —no manda HMAC, ni JWT, ni cabecera de firma—, así que la única
    prueba de que quien llama es Brevo es que conozca una URL que nadie más conoce. Sin este valor
    el endpoint responde 401 en vez de quedar abierto: un webhook de entregas que acepta cualquier
    cuerpo deja que un tercero marque como fallido el SMS de un cliente y lo silencie.

    Es un secreto de verdad: 32 caracteres o más, y aparecerá en los logs de acceso del proxy, así
    que se rota como cualquier otra credencial.
  */
  BREVO_WEBHOOK_SECRET: z.preprocess(vacioEsAusente, z.string().min(32).optional()),

  /*
    El número de WhatsApp Business dado de alta en Brevo, con código de país.

    Brevo lo quiere en dígitos y sin `+` (`59170000000`); se normaliza igual al enviar, pero se
    documenta así para que lo que está en el `.env` sea lo mismo que se ve en el panel.
  */
  BREVO_WHATSAPP_SENDER_NUMBER: optionalNonEmptyStringEnvSchema,

  /*
    La plantilla aprobada con la que se abre una conversación de WhatsApp.

    No es opcional en la práctica: WhatsApp sólo deja escribir texto libre DENTRO de las 24 h
    siguientes a que la persona escriba primero, y ATLAS nunca recibe WhatsApp entrante. Todo lo que
    manda ATLAS —el código de verificación, un aviso de cuota, una campaña— es un mensaje iniciado
    por la empresa, y ésos van SIEMPRE por plantilla aprobada por Meta. Un despliegue con WhatsApp en
    `brevo` y sin esto enviaría texto libre y lo rechazarían todos los mensajes, uno por uno.

    El identificador es el de `Campañas > WhatsApp` en el panel de Brevo. Un mensaje concreto puede
    pedir otra con `payload.whatsappTemplateId`.
  */
  BREVO_WHATSAPP_DEFAULT_TEMPLATE_ID: z.preprocess(vacioEsAusente, z.coerce.number().int().positive().optional()),
} as const;
