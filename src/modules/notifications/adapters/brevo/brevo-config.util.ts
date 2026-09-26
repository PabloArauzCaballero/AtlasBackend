/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza distingue «Brevo está configurado» de «falta exactamente esto».
 * @system resuelve la configuración de los dos canales de Brevo sin tocar `env`, para poder ejercitarla.
 */

/** Lo que hace falta para poner un SMS en Brevo, ya resuelto: clave, remitente y callback. */
export type BrevoSmsConfig = {
  apiKey: string;
  sender: string;
  statusCallbackUrl: string | null;
  defaultCountryCode: string;
};
export type BrevoSmsConfigResult = { ok: true; value: BrevoSmsConfig } | { ok: false; missing: string };

/** Lo que hace falta para poner un WhatsApp en Brevo: clave, número de origen y plantilla. */
export type BrevoWhatsAppConfig = {
  apiKey: string;
  senderNumber: string;
  defaultTemplateId: number | null;
  defaultCountryCode: string;
};
export type BrevoWhatsAppConfigResult = { ok: true; value: BrevoWhatsAppConfig } | { ok: false; missing: string };

/** Fuente cruda: las mismas variables de entorno, pero recibidas en vez de leídas. */
export type BrevoEnvSource = {
  apiKey: string | undefined;
  smsSender: string | undefined;
  statusCallbackUrl: string | undefined;
  whatsappSenderNumber: string | undefined;
  whatsappDefaultTemplateId: number | undefined;
  defaultCountryCode: string;
};

function present(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value.trim() : null;
}

/**
 * La configuración de SMS, o el nombre de la PRIMERA pieza que falta.
 *
 * Devuelve una unión discriminada en vez de lanzar por la misma razón que Twilio, Gmail y APNs: el
 * adaptador nunca lanza desde `send`, contesta un `DeliveryResult` fallido con el código exacto. Un
 * canal que explota es un canal que además tumba la campaña entera; uno que contesta «falta la
 * clave» deja el resto de destinatarios intactos y dice qué arreglar.
 */
export function resolveBrevoSmsConfig(source: BrevoEnvSource): BrevoSmsConfigResult {
  const apiKey = present(source.apiKey);
  if (!apiKey) return { ok: false, missing: 'BREVO_API_KEY_MISSING' };
  const sender = present(source.smsSender);
  if (!sender) return { ok: false, missing: 'BREVO_SMS_SENDER_MISSING' };
  return {
    ok: true,
    value: {
      apiKey,
      sender,
      statusCallbackUrl: present(source.statusCallbackUrl),
      defaultCountryCode: source.defaultCountryCode,
    },
  };
}

/**
 * La configuración de WhatsApp, o el nombre de la PRIMERA pieza que falta.
 *
 * La plantilla por defecto puede venir vacía y aquí no es un error: un mensaje concreto puede traer
 * la suya en el payload. Quien decide si el envío es posible sin ninguna de las dos es el adaptador,
 * que es donde se sabe qué mensaje se está mandando.
 */
export function resolveBrevoWhatsAppConfig(source: BrevoEnvSource): BrevoWhatsAppConfigResult {
  const apiKey = present(source.apiKey);
  if (!apiKey) return { ok: false, missing: 'BREVO_API_KEY_MISSING' };
  const senderNumber = present(source.whatsappSenderNumber);
  if (!senderNumber) return { ok: false, missing: 'BREVO_WHATSAPP_SENDER_NUMBER_MISSING' };
  return {
    ok: true,
    value: {
      apiKey,
      senderNumber,
      defaultTemplateId: source.whatsappDefaultTemplateId ?? null,
      defaultCountryCode: source.defaultCountryCode,
    },
  };
}
