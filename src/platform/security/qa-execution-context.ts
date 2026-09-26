/**
 * @file Utilidad de plataforma: identidad del entorno y contexto QA confiable de una petición.
 * @business Esta pieza hace que el tráfico de una corrida QA llegue al mock etiquetado con SU
 *   corrida y persona, y que ninguna cabecera de un cliente público pueda fingirlo.
 * @system credencial HS256 de vida corta emitida por el worker + `AsyncLocalStorage` que la
 *   ejecución externa lee sin que el contexto entre en el `input` de negocio.
 *
 * Cierra H09/H10: `callMockServer` ya sabía propagar `qaContext`, pero nadie lo rellenaba en la
 * ejecución de negocio. Rellenarlo desde cabeceras `x-mock-*` del cliente sería el agujero que el
 * emulador rechaza a propósito (`INVALID_RUN_TOKEN`); por eso aquí sólo se activa con una firma del
 * propio backend, y el `runToken` del mock sale del registro de la corrida, nunca de la petición.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type DeploymentEnvironment = 'LOCAL' | 'TEST' | 'STAGING' | 'PROD';

export const QA_EXECUTION_HEADER = 'x-atlas-qa-execution';
const AUDIENCE = 'atlas-backend-qa';
/** Una credencial vale para UNA operación y poco tiempo: robarla de un log no sirve de mucho. */
export const QA_CREDENTIAL_TTL_SECONDS = 120;

/**
 * Identidad del entorno de negocio. La declara el despliegue; sin declarar, `NODE_ENV=production`
 * se lee como PROD, que es el comportamiento más restrictivo y el que había antes.
 */
export function deploymentEnvironment(source: NodeJS.ProcessEnv = process.env): DeploymentEnvironment {
  const declared = source.ATLAS_DEPLOYMENT_ENVIRONMENT?.trim().toUpperCase();
  if (declared === 'LOCAL' || declared === 'TEST' || declared === 'STAGING' || declared === 'PROD') return declared;
  return source.NODE_ENV === 'production' ? 'PROD' : 'LOCAL';
}

/** QA ejecutable: habilitado a propósito y nunca en PROD. */
export function qaExecutionAllowed(source: NodeJS.ProcessEnv = process.env): boolean {
  if (deploymentEnvironment(source) === 'PROD') return false;
  return /^(1|true|yes|on)$/i.test(source.QA_EXECUTION_ENABLED ?? '');
}

export type QaCredentialClaims = {
  tenantId: string;
  runId: string;
  personaKey: string;
  logicalOperationId: string;
  attempt: number;
  environment: DeploymentEnvironment;
};

type SignedClaims = QaCredentialClaims & { aud: string; iat: number; exp: number; v: 1 };

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function mac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signQaCredential(claims: QaCredentialClaims, secret: string, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const body: SignedClaims = { ...claims, aud: AUDIENCE, iat, exp: iat + QA_CREDENTIAL_TTL_SECONDS, v: 1 };
  const payload = b64url(JSON.stringify(body));
  return `v1.${payload}.${mac(payload, secret)}`;
}

export type QaCredentialVerdict =
  | { ok: true; claims: QaCredentialClaims }
  | { ok: false; code: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'WRONG_AUDIENCE' | 'WRONG_ENVIRONMENT' };

export function verifyQaCredential(
  token: string,
  secret: string,
  environment: DeploymentEnvironment,
  nowMs = Date.now(),
): QaCredentialVerdict {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return { ok: false, code: 'MALFORMED' };
  const expected = Buffer.from(mac(parts[1], secret));
  const received = Buffer.from(parts[2]);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return { ok: false, code: 'BAD_SIGNATURE' };
  let body: SignedClaims;
  try {
    body = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as SignedClaims;
  } catch {
    return { ok: false, code: 'MALFORMED' };
  }
  if (body.aud !== AUDIENCE || body.v !== 1) return { ok: false, code: 'WRONG_AUDIENCE' };
  if (typeof body.exp !== 'number' || body.exp * 1000 < nowMs) return { ok: false, code: 'EXPIRED' };
  // Una credencial emitida para TEST no activa nada en otro entorno, y PROD nunca la acepta.
  if (body.environment !== environment || environment === 'PROD') return { ok: false, code: 'WRONG_ENVIRONMENT' };
  const { tenantId, runId, personaKey, logicalOperationId, attempt } = body;
  if (![tenantId, runId, personaKey, logicalOperationId].every((value) => typeof value === 'string' && value !== ''))
    return { ok: false, code: 'MALFORMED' };
  return {
    ok: true,
    claims: { tenantId, runId, personaKey, logicalOperationId, attempt: Number(attempt) || 1, environment: body.environment },
  };
}

/** Contexto que el adaptador del mock convierte en cabeceras `x-mock-*`. Misma forma que `QaRunContext`. */
export type ActiveQaContext = {
  tenantId: string;
  runId: string;
  runToken: string;
  personaKey: string;
  logicalOperationId: string;
  attempt: number;
  epoch?: string;
};

const storage = new AsyncLocalStorage<ActiveQaContext>();

export function runWithQaContext<T>(context: ActiveQaContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** El contexto de la petición en curso, o `undefined` si no la originó una corrida QA autorizada. */
export function currentQaContext(): ActiveQaContext | undefined {
  return storage.getStore();
}
