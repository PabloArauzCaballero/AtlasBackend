/**
 * @file Variables de los proveedores de avisos push, en su propio módulo.
 * @business Esta pieza reúne lo que hace falta para que un aviso llegue a un teléfono, Android o iPhone.
 * @system se separa de `env.schema.ts` para no engordar un archivo que ya roza el límite de tamaño.
 */
import { z } from 'zod';

export const pushProviderEnvShape = {
  FCM_PROJECT_ID: z.string().optional(),
  FCM_CLIENT_EMAIL: z.string().optional(),
  FCM_PRIVATE_KEY: z.string().optional(),

  /*
    APNs (iPhone). Un token de iOS es de Apple, no de Firebase: mandarlo a FCM lo rechaza siempre.

    `APNS_ENVIRONMENT` es `production` por omisión porque es lo que usan TestFlight y la App Store; un
    build firmado con perfil de desarrollo necesita `sandbox`, y el token de uno NO vale en el otro
    (Apple responde `BadDeviceToken`, que se lee como token corrupto).
  */
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_PRIVATE_KEY: z.string().optional(),
  APNS_BUNDLE_ID: z.string().optional(),
  APNS_ENVIRONMENT: z.enum(['production', 'sandbox']).default('production'),
} as const;
