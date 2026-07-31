/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { ForbiddenException } from '@nestjs/common';
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { stableStringify } from '../../../common/utils/privacy/redaction.util.js';
import {
  ExternalProviderCode,
  ExternalProviderMode,
  ExternalProviderRawResult,
  ExternalProviderStatus,
  NormalizedExternalObservation,
} from '../domain/external-provider.types.js';

export const CORE_SCORING_FEATURES = [
  'identity_document_exists',
  'identity_name_match_score',
  'identity_verification_status',
  'identity_confidence_level',
  'phone_trust_score',
  'phone_fraud_risk_score',
  'whatsapp_contactability_score',
  'digital_trust_score',
] as const;

export const PRODUCTION_CREDENTIAL_REQUIREMENTS: Record<string, string[]> = {
  SEGIP: ['SEGIP_BASE_URL', 'SEGIP_CLIENT_ID', 'SEGIP_CLIENT_SECRET'],
  INFOCENTER: ['INFOCENTER_BASE_URL', 'INFOCENTER_CLIENT_ID', 'INFOCENTER_CLIENT_SECRET'],
  QR_GENERIC: ['QR_GENERIC_BASE_URL'],
  QR_BCB_GENERIC: ['QR_GENERIC_BASE_URL'],
  BANKING_GENERIC: ['BANKING_GENERIC_BASE_URL'],
  TELCO_GENERIC: ['TELCO_GENERIC_BASE_URL'],
  FACEBOOK_META: ['META_FACEBOOK_APP_ID', 'META_FACEBOOK_APP_SECRET', 'META_FACEBOOK_REDIRECT_URI'],
  WHATSAPP_GENERIC: ['WHATSAPP_PROVIDER'],
  DIGITAL_TRUST_GENERIC: ['DIGITAL_TRUST_GENERIC_BASE_URL'],
};

export function toProviderCode(providerCode: string): ExternalProviderCode {
  const normalized = providerCode.trim().toUpperCase();
  return (normalized === 'CGIP' ? 'SEGIP' : normalized) as ExternalProviderCode;
}

/**
 * Modos en los que el adaptador NO habla con el proveedor real: `mock_local` fabrica el payload en
 * proceso y `mock_server` lo pide al servidor de mocks (`AtlasExternalProvidersMock`). En ambos, la
 * evidencia que se persiste como observaciones y features del cliente es inventada.
 */
export const MOCK_MODES: readonly ExternalProviderMode[] = ['mock_local', 'mock_server'];

export function isMockMode(mode: ExternalProviderMode): boolean {
  return MOCK_MODES.includes(mode);
}

/**
 * Escape hatch explícito para servir datos simulados en producción (una demo comercial sobre un
 * despliegue productivo, por ejemplo). Por defecto es `false`: en producción, un proveedor en modo
 * simulado queda BLOQUEADO, no degradado en silencio. Ver `productionIntegrationBlockers`.
 */
export function mockDataAllowedInProduction(): boolean {
  return envBoolean('EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION', false);
}

export function isProductionRuntime(): boolean {
  return envValue('NODE_ENV') === 'production';
}

/**
 * Normaliza un modo ya DECLARADO (columna `default_mode` de `external_data_providers`, override por
 * `${CODE}_MODE`, o el `mode_used` histórico de una request). El default `mock_local` es el correcto
 * para desarrollo y para releer filas antiguas; NO es una autorización para servir datos simulados
 * en producción — eso lo decide `productionIntegrationBlockers`, que bloquea la ejecución.
 */
export function toMode(value: string | null | undefined): ExternalProviderMode {
  const normalized = (value ?? 'mock_local').trim().toLowerCase();
  if (['mock_local', 'mock_server', 'sandbox', 'production', 'disabled'].includes(normalized)) return normalized as ExternalProviderMode;
  return 'mock_local';
}

export function envValue(key: string): string | undefined {
  const value = process.env[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export function providerModeFromEnv(providerCode: string, fallback: string | null | undefined): ExternalProviderMode {
  return toMode(envValue(`${providerCode}_MODE`) ?? fallback);
}

/**
 * URL base del servidor de mocks. En producción NO hay default: si nadie configuró
 * `EXTERNAL_PROVIDERS_MOCK_BASE_URL`, devuelve `undefined` y `callMockServer` falla con
 * `*_MOCK_BASE_URL_NOT_CONFIGURED` en vez de intentar un `localhost` que en un contenedor de
 * producción apunta al propio pod. Fuera de producción se mantiene el default de desarrollo, que es
 * el puerto del repo `AtlasExternalProvidersMock`.
 */
export function mockBaseUrlFor(providerCode: string): string | undefined {
  const explicit = envValue(`${providerCode}_MOCK_BASE_URL`);
  if (explicit) return explicit;
  const normalizedProvider = providerCode.toUpperCase();
  const configuredBase = envValue('EXTERNAL_PROVIDERS_MOCK_BASE_URL');
  if (!configuredBase && isProductionRuntime()) return undefined;
  const base = configuredBase ?? 'http://localhost:4010/mock';
  const paths: Record<string, string> = {
    SEGIP: '/segip',
    INFOCENTER: '/infocenter',
    QR_GENERIC: '/qr',
    QR_BCB_GENERIC: '/qr',
    BANKING_GENERIC: '/banking',
    TELCO_GENERIC: '/telco',
    FACEBOOK_META: '/facebook',
    WHATSAPP_GENERIC: '/whatsapp',
    DIGITAL_TRUST_GENERIC: '/digital-trust',
  };
  return `${base}${paths[normalizedProvider] ?? `/${normalizedProvider.toLowerCase()}`}`;
}

export function envBoolean(key: string, defaultValue: boolean): boolean {
  const value = envValue(key);
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function envNumber(key: string, defaultValue: number): number {
  const value = envValue(key);
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

/**
 * Razones por las que un proveedor NO puede servir evidencia con la configuración actual. La lista
 * vacía significa "puede ejecutar"; cualquier elemento bloquea la request con
 * `PROVIDER_UNAVAILABLE` + `PRODUCTION_GATE_BLOCKED:<razones>` y deja constancia en
 * `data_provider_requests`, en vez de devolver un resultado.
 *
 * El bloqueo por modo simulado (hallazgo A-02 de la auditoría integral 2026-07-30) es el que impide
 * el fallo silencioso más grave: los nueve proveedores se siembran con `default_mode = 'mock_local'`
 * (`seeders/production/20260702032000-seed-external-data-providers.ts`) y `toMode` también cae a
 * `mock_local`, así que un despliegue productivo que no fije `${CODE}_MODE=production`
 * verificaba identidades y calculaba riesgo sobre payloads inventados por el propio adaptador,
 * persistidos como observaciones y features del cliente. Ahora falla cerrado.
 */
export function productionIntegrationBlockers(providerCode: string, mode: ExternalProviderMode): string[] {
  const code = toProviderCode(providerCode);

  if (isProductionRuntime() && isMockMode(mode) && !mockDataAllowedInProduction()) {
    return [`${code}_MOCK_MODE_IN_PRODUCTION`];
  }

  if (mode !== 'production') return [];
  const blockers: string[] = [];
  if (!envBoolean(`${code}_REAL_INTEGRATION_IMPLEMENTED`, false)) blockers.push(`${code}_REAL_INTEGRATION_NOT_IMPLEMENTED`);
  const requiredKeys = PRODUCTION_CREDENTIAL_REQUIREMENTS[code] ?? [`${code}_BASE_URL`];
  for (const key of requiredKeys) {
    if (!envValue(key)) blockers.push(`${key}_MISSING`);
  }
  if (envBoolean(`${code}_ALLOW_MOCK_IN_PROD`, false)) blockers.push(`${code}_MOCK_ALLOWED_IN_PRODUCTION`);
  return blockers;
}

/**
 * ATLAS-ROBUSTEZ: fail-fast de configuración al arrancar, para CUALQUIER proveedor externo que
 * un operador active explícitamente en modo `production` vía `${CODE}_MODE=production` — antes
 * de este mecanismo, la falta de una credencial (`SEGIP_CLIENT_SECRET`, etc.) recién se
 * descubría en `productionIntegrationBlockers` en el momento de la primera request real
 * (bloqueando esa request con un `PRODUCTION_GATE_BLOCKED`, pero sin impedir que el proceso
 * arrancara con una configuración a medio hacer). Deliberadamente NO consulta la base de datos
 * (a diferencia de `defaultMode`, que si vive en `context_catalogs`/`external_providers`) — solo
 * mira el override explícito por variable de entorno, para que el chequeo sea síncrono y no
 * dependa de que la conexión a la base de datos ya esté lista en el momento del boot. Solo cubre
 * `production` (no `sandbox`), igual que `productionIntegrationBlockers`.
 */
export function externalProviderBootRequirements(): Array<{
  providerValue: string;
  channelOrDomain: string;
  requiredEnvVars: Array<{ name: string; value: string | undefined }>;
}> {
  const requirements: Array<{
    providerValue: string;
    channelOrDomain: string;
    requiredEnvVars: Array<{ name: string; value: string | undefined }>;
  }> = [];
  for (const code of Object.keys(PRODUCTION_CREDENTIAL_REQUIREMENTS)) {
    const modeOverride = envValue(`${code}_MODE`);
    if (modeOverride?.trim().toLowerCase() !== 'production') continue;
    const requiredKeys = PRODUCTION_CREDENTIAL_REQUIREMENTS[code] ?? [`${code}_BASE_URL`];
    requirements.push({
      providerValue: 'production',
      channelOrDomain: `${code}_MODE`,
      requiredEnvVars: requiredKeys.map((name) => ({ name, value: envValue(name) })),
    });
  }
  return requirements;
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function policyNumber(value: number | string | null | undefined, defaultValue: number): number {
  if (value === null || value === undefined) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

export function isConsentRequiredError(error: unknown): boolean {
  if (error instanceof ForbiddenException) return true;
  return error instanceof Error && error.message.includes('CONSENT_REQUIRED');
}

export function consentPurposeCodes(providerCode: string, purpose: string): string[] {
  const normalizedProvider = providerCode.toLowerCase();
  const normalizedPurpose = purpose.toLowerCase();
  return [
    purpose,
    normalizedPurpose,
    'risk_fraud_assessment',
    'external_data',
    `external_${normalizedPurpose}`,
    `${normalizedProvider}_${normalizedPurpose}`,
  ];
}

export function statusFromRaw(raw: ExternalProviderRawResult): ExternalProviderStatus {
  if (raw.statusCode === 401 || raw.statusCode === 403 || ['UNAUTHORIZED', 'FORBIDDEN'].includes(raw.status)) return 'PROVIDER_AUTH_FAILED';
  if (raw.statusCode === 429 || raw.status === 'RATE_LIMITED') return 'RATE_LIMITED';
  if (raw.statusCode && raw.statusCode >= 500) return 'PROVIDER_UNAVAILABLE';
  if (raw.status === 'BLOCKED_BY_COST_POLICY') return 'BLOCKED_BY_COST_POLICY';
  if (raw.status === 'DATA_NOT_AVAILABLE') return 'DATA_NOT_AVAILABLE';
  if (['PROVIDER_UNAVAILABLE', 'SEGIP_TIMEOUT'].includes(raw.status)) return 'PROVIDER_UNAVAILABLE';
  if (raw.isMocked) return 'MOCKED';
  return 'COMPLETED';
}

export function featuresFromObservations(observations: NormalizedExternalObservation[]): Record<string, unknown> {
  const features: Record<string, unknown> = {};
  for (const observation of observations) {
    if (observation.valueType === 'BOOLEAN') features[observation.featureKey] = observation.valueBoolean ?? null;
    if (observation.valueType === 'NUMBER') features[observation.featureKey] = observation.valueNumber ?? null;
    if (observation.valueType === 'STRING') features[observation.featureKey] = observation.valueString ?? null;
    if (observation.valueType === 'DATE') features[observation.featureKey] = observation.valueDate ?? null;
    if (observation.valueType === 'JSON') features[observation.featureKey] = observation.valueJson ?? null;
    features[`${observation.featureKey}__confidence`] = observation.confidenceScore ?? null;
  }
  return features;
}

export function payloadHash(payload: unknown): string {
  return sha256Hex(stableStringify(payload));
}
