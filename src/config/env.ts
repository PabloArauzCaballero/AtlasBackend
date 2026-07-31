/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida y compone configuración tipada al arrancar.
 */
import 'dotenv/config';
import { envBaseSchema, type RawAppEnv } from './env.schema.js';
import { applyEnvCrossChecks } from './env-cross-checks.js';

// El esquema por campo vive en `env.schema.ts` y las validaciones cruzadas en `env-cross-checks.ts`.
// Este archivo solo compone ambos, parsea una vez al arrancar y expone el resultado tipado.
const envSchema = envBaseSchema.superRefine(applyEnvCrossChecks);

export type AppEnv = Omit<RawAppEnv, 'API_DOCS_ENABLED' | 'AUTH_COOKIE_SECURE'> & {
  API_DOCS_ENABLED: boolean;
  AUTH_COOKIE_SECURE: boolean;
};

function parseEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `- ${issue.path.join('.') || 'ENV'}: ${issue.message}`).join('\n');
    throw new Error(
      `Configuración de entorno inválida para ATLAS.\n${details}\n\n` +
        'Para desarrollo local usa `yarn start:dev` y asegúrate de que NODE_ENV=development en tu .env. ' +
        'Para producción configura REDIS_URL y secretos reales, no los valores de ejemplo.',
    );
  }

  // `SameSite=None` sin `Secure` es rechazado por los navegadores: la sesión simplemente no se
  // establecería. Se falla al arrancar con un mensaje claro en vez de dejar un login roto en runtime.
  const cookieSecure = parsed.data.AUTH_COOKIE_SECURE ?? parsed.data.NODE_ENV === 'production';
  if (parsed.data.AUTH_COOKIE_SAMESITE === 'none' && !cookieSecure) {
    throw new Error(
      'Configuración de entorno inválida para ATLAS.\n' +
        '- AUTH_COOKIE_SAMESITE=none exige AUTH_COOKIE_SECURE=true (los navegadores descartan la cookie si no).',
    );
  }

  // PII cifrada sin KMS: en producción sin KMS_KEY_ID+AWS_REGION, la master key se deriva de una env
  // var (SHA-256). Es un despliegue legítimo en la etapa actual, pero comprometer esa variable
  // descifra toda la PII, así que se avisa ruidosamente (no se bloquea el arranque). Ver
  // docs/audit/revision-completa-backend-2026-07-21.md (S-M3).
  if (parsed.data.NODE_ENV === 'production' && !(parsed.data.KMS_KEY_ID && parsed.data.AWS_REGION)) {
    console.warn(
      '[ATLAS][SEGURIDAD] Producción sin KMS: la PII se cifra con clave derivada de una variable de ' +
        'entorno. Configura KMS_KEY_ID + AWS_REGION y ejecuta `yarn crypto:reencrypt-pii` para migrar ' +
        'los valores existentes al proveedor KMS.',
    );
  }

  return {
    ...parsed.data,
    API_DOCS_ENABLED: parsed.data.API_DOCS_ENABLED ?? parsed.data.NODE_ENV !== 'production',
    AUTH_COOKIE_SECURE: cookieSecure,
  };
}

export const env: AppEnv = parseEnv();

export function getAllowedCorsOrigins(): string[] {
  return [...new Set([...env.CORS_ORIGINS.split(','), env.INTERNAL_FRONTEND_ORIGIN])]
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
