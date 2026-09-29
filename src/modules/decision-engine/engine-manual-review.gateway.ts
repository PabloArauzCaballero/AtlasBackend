/**
 * @file Adaptador de infraestructura: anexa el expediente del alta al caso de revisión del Motor.
 * @business El analista que abre el caso de identidad en el portal del Motor ve todo lo que el teléfono dejó (tiempos, dispositivo, permisos, ubicación, agenda, SEGIP), no sólo las fotos.
 * @system `PUT /v1/manual-reviews/by-execution/:executionId/onboarding-dossier`, una sola vez, con plazo corto; nunca lanza.
 */
import { env } from '../../config/env.js';
import type { EngineTransportService } from './engine-transport.service.js';

/** Plazo del anexo. Es accesorio: si el Motor tarda más, el alta sigue y se reintenta en el siguiente hito. */
export const ONBOARDING_DOSSIER_TIMEOUT_MS = 4_000;

/** Los cuatro campos que el Motor admite; cualquier otro es 400. Sin ellos, IDENTIDAD / 50 / 240 min / REVISION_HUMANA_OBLIGATORIA. */
export type OnboardingDossierOpenIfMissing = {
  queueCode?: string;
  priority?: number;
  slaMinutes?: number;
  motivo?: string;
};

export type OnboardingDossierRequest = {
  dossier: Record<string, unknown>;
  /** Sin él, un caso inexistente es 404; con él, el Motor lo abre en `OPEN` con `{ motivo, alta }`. */
  openIfMissing?: OnboardingDossierOpenIfMissing;
};

/**
 * `final`: reintentar no cambia nada. 409 `MANUAL_REVIEW_CLOSED` (el caso ya se resolvió), 413
 * `ONBOARDING_DOSSIER_TOO_LARGE` y los 400 de contrato. Un 404 o un fallo de red NO son finales: el
 * siguiente hito del alta vuelve a mandarlo (el PUT es idempotente y reemplaza el expediente).
 */
export type OnboardingDossierResult =
  | { ok: true; status: number; caseCode: string | null; created: boolean | null }
  | { ok: false; status: number | null; reason: string; final: boolean };

/**
 * El anexo del expediente del alta al caso de revisión manual del Motor.
 *
 * Va con la llave de EJECUCIÓN (`DECISION_ENGINE_API_KEY`) y las mismas cabeceras que
 * `DecisionEngineClient.execute`: es la identidad de servicio que ya creó la ejecución, y el Motor
 * localiza el caso por esa ejecución.
 *
 * No pasa por el circuito del Motor (`EngineTransportService.send`): un anexo que falla no puede
 * cortar las decisiones. Y NUNCA lanza: devuelve el desenlace para que quien llama lo registre.
 */
export class EngineManualReviewGateway {
  constructor(
    private readonly transport: EngineTransportService,
    private readonly isConfigured: () => boolean,
  ) {}

  async putOnboardingDossier(executionId: string, body: OnboardingDossierRequest): Promise<OnboardingDossierResult> {
    if (!this.isConfigured()) return { ok: false, status: null, reason: 'DECISION_ENGINE_NOT_CONFIGURED', final: false };
    try {
      const url = `${this.transport.baseUrl()}/v1/manual-reviews/by-execution/${encodeURIComponent(executionId)}/onboarding-dossier`;
      const raw = await this.transport.send(url, env.DECISION_ENGINE_API_KEY ?? '', body, {
        method: 'PUT',
        timeoutMs: ONBOARDING_DOSSIER_TIMEOUT_MS,
        headers: { 'x-tenant-id': env.DECISION_ENGINE_TENANT_ID },
      });
      if (!raw.ok) {
        const final = raw.status === 400 || raw.status === 409 || raw.status === 413;
        return { ok: false, status: raw.status, reason: codigoDeError(raw.json) ?? `HTTP ${raw.status}`, final };
      }
      const data = (raw.json.data ?? raw.json) as Record<string, unknown>;
      return {
        ok: true,
        status: raw.status,
        caseCode: typeof data.caseCode === 'string' ? data.caseCode : null,
        created: typeof data.created === 'boolean' ? data.created : null,
      };
    } catch (error: unknown) {
      return { ok: false, status: null, reason: error instanceof Error ? error.message : String(error), final: false };
    }
  }
}

/** El código del Motor (`error.code` de su ProblemDetails, o `code`/`title` a secas). */
function codigoDeError(json: Record<string, unknown>): string | null {
  const error = json.error as { code?: unknown } | undefined;
  for (const candidato of [error?.code, json.code, json.title]) if (typeof candidato === 'string' && candidato) return candidato;
  return null;
}
