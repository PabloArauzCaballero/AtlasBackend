/**
 * @file Variables de WhatsApp por Meta Cloud API en su propio módulo.
 * @business Esta pieza reúne lo que hace falta para escribir por WhatsApp sin intermediario.
 * @system se separa de `env.schema.ts` por lo mismo que los bloques de Twilio y Brevo: ese archivo roza el gate de tamaño.
 */
import { z } from 'zod';

export const metaWhatsAppProviderEnvShape = {
  META_WHATSAPP_TOKEN: z.string().optional(),
  META_WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  /** Plantilla de respaldo. Preferir el mapeo explícito por evento o `template_code`. */
  META_WHATSAPP_DEFAULT_TEMPLATE_NAME: z.string().optional(),
  META_WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE: z.string().default('es'),
} as const;
