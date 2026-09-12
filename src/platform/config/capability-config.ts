/**
 * @file Configuración por capacidad (AT-046).
 * @business Un proceso valida y recibe sólo la configuración de las capacidades que ejecuta: un worker de
 *   mensajería no exige secretos KYC; una capacidad que maneja PII con KMS requerido falla cerrado si no
 *   hay KMS, en vez de degradar a cifrado local sin que nadie lo decida.
 * @system Rebanadas Zod sobre el `process.env` ya validado; cada capacidad declara sus variables y su
 *   política de cifrado. Los nombres operativos no cambian (compatibilidad con .env y despliegues).
 */
import { z } from 'zod';

export type CapabilityCode = 'messaging' | 'credit' | 'kyc' | 'events' | 'jobs';

export type EncryptionPolicy = Readonly<{ handlesPii: boolean; requireKms: boolean }>;

const base = { NODE_ENV: z.string().default('development') };

const capabilitySchemas = {
  messaging: z.object({ ...base, NOTIFICATION_TOKEN_ENCRYPTION_KEY: z.string().min(32) }),
  credit: z.object({ ...base, DB_HOST: z.string().min(1), DB_NAME: z.string().min(1) }),
  kyc: z.object({ ...base, SEGIP_MODE: z.string().optional(), EXTERNAL_PROVIDERS_MOCK_BASE_URL: z.string().optional() }),
  events: z.object({ ...base, EVENTS_RELAY_V2_ENABLED: z.string().optional() }),
  jobs: z.object({ ...base, RUNTIME_JOBS_SCHEDULER_ENABLED: z.string().optional(), REDIS_URL: z.string().optional() }),
} as const;

export const ENCRYPTION_POLICIES: Readonly<Record<CapabilityCode, EncryptionPolicy>> = Object.freeze({
  messaging: { handlesPii: true, requireKms: false },
  credit: { handlesPii: true, requireKms: false },
  kyc: { handlesPii: true, requireKms: true },
  events: { handlesPii: false, requireKms: false },
  jobs: { handlesPii: false, requireKms: false },
});

export class CapabilityConfigError extends Error {
  constructor(
    readonly capability: CapabilityCode,
    readonly code: 'MISSING_CONFIG' | 'KMS_REQUIRED',
    detail: string,
  ) {
    super(`${code}: capacidad «${capability}» — ${detail}`);
    this.name = 'CapabilityConfigError';
  }
}

export type CapabilityConfig<C extends CapabilityCode> = z.infer<(typeof capabilitySchemas)[C]>;

/** Valida SOLO las variables de esa capacidad; no exige las de otras. Nunca devuelve valores parciales. */
export function loadCapabilityConfig<C extends CapabilityCode>(
  capability: C,
  source: Record<string, string | undefined> = process.env,
): CapabilityConfig<C> {
  const parsed = capabilitySchemas[capability].safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new CapabilityConfigError(capability, 'MISSING_CONFIG', `faltan o son inválidas: ${missing}`);
  }
  return parsed.data as CapabilityConfig<C>;
}

export type EncryptionDecision = Readonly<{ provider: 'kms' | 'local' }>;

/**
 * Decide el proveedor de cifrado de una capacidad. Con KMS configurado, KMS. Sin KMS: si la capacidad lo
 * exige (o `ENCRYPTION_REQUIRE_KMS=true` en producción), falla cerrado; si no, local. Nunca hay un
 * «fallback silencioso» para una capacidad que exige KMS.
 */
export function decideEncryptionProvider(
  capability: CapabilityCode,
  source: Record<string, string | undefined> = process.env,
): EncryptionDecision {
  const hasKms = Boolean(source.KMS_KEY_ID && source.AWS_REGION);
  if (hasKms) return { provider: 'kms' };
  const policy = ENCRYPTION_POLICIES[capability];
  const productionRequires = source.NODE_ENV === 'production' && source.ENCRYPTION_REQUIRE_KMS === 'true' && policy.handlesPii;
  if (policy.requireKms || productionRequires) {
    throw new CapabilityConfigError(
      capability,
      'KMS_REQUIRED',
      'maneja PII con KMS requerido y no hay KMS_KEY_ID + AWS_REGION; no se degrada a cifrado local',
    );
  }
  return { provider: 'local' };
}
