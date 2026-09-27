/**
 * @file Adaptador de infraestructura: plano de control del emulador de proveedores.
 * @business Esta pieza da a cada corrida su propio namespace en el mock y lee su journal COMPLETO,
 *   que es la prueba de que el tráfico salió por la red y no por un `fetch` interceptado.
 * @system HTTP contra `/mock/control/*` con el token de administración; nunca expone el runToken.
 *
 * Contrato confirmado contra `AtlasExternalProvidersMock@origin/dev` (`src/control/routes.mjs`):
 * `POST /mock/control/runs` → 201 `{ runToken, epoch, … }`; `GET …/runs/:runId/journal?after&limit`
 * con cursor (`nextCursor`, `hasMore`, `totalAppended`, `droppedByRetention`), `limit` ≤ 1000;
 * `DELETE …/runs/:runId`; `GET /mock/providers` con la matriz proveedor × escenario;
 * `POST /mock/qa/identity-images` → `{ version, images: { identity_front|identity_back|selfie } }`.
 */
import { createHash } from 'node:crypto';

export type MockJournalEntry = {
  sequence: number;
  type?: string;
  provider?: string;
  operation?: string;
  personaKey?: string | null;
  logicalOperationId?: string | null;
  attempt?: number | null;
  status?: number;
  occurredAt?: string;
  [key: string]: unknown;
};

type JsonObject = Record<string, unknown>;

const obj = (value: unknown): JsonObject => (value !== null && typeof value === 'object' ? (value as JsonObject) : {});
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** Lo que el mock necesita para dibujar el carnet y la selfie de UNA persona sintética. */
export type MockIdentityPersona = {
  personaKey: string;
  firstName: string;
  lastName: string;
  documentNumber: string;
  birthDate: string;
  sex?: 'M' | 'F';
  city?: string;
};

export const MOCK_IDENTITY_IMAGE_KINDS = ['identity_front', 'identity_back', 'selfie'] as const;
export type MockIdentityImageKind = (typeof MOCK_IDENTITY_IMAGE_KINDS)[number];
export type MockIdentityImage = { contentType: string; bytes: Uint8Array; sha256: string };

/** `ok: false` lleva un motivo corto (`HTTP_404`, `SHA256_MISMATCH:selfie`, `UNREACHABLE`…) para la evidencia. */
export type MockIdentityImages =
  { ok: true; version: string; images: Record<MockIdentityImageKind, MockIdentityImage> } | { ok: false; reason: string };

export type MockJournal = { entries: MockJournalEntry[]; totalAppended: number; droppedByRetention: number; complete: boolean };

export class MockControlClient {
  constructor(private readonly options: { controlUrl: string | undefined; controlToken: string | undefined; timeoutMs?: number }) {}

  get configured(): boolean {
    return Boolean(this.options.controlUrl && this.options.controlToken);
  }

  private async call(
    method: string,
    path: string,
    tenantId: string | null,
    body?: unknown,
    timeoutMs?: number,
  ): Promise<{ status: number; body: JsonObject }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.options.timeoutMs ?? 5_000);
    try {
      const response = await fetch(`${String(this.options.controlUrl).replace(/\/+$/, '')}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(this.options.controlToken ? { authorization: `Bearer ${this.options.controlToken}` } : {}),
          ...(tenantId ? { 'x-mock-tenant-id': tenantId } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      return { status: response.status, body: obj(parsed) };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Salud y matriz de escenarios por proveedor. `null` si el mock no responde. */
  async capabilities(): Promise<{ reachable: boolean; schemaVersion: string | null; scenarios: Record<string, string[]> | null }> {
    if (!this.options.controlUrl) return { reachable: false, schemaVersion: null, scenarios: null };
    try {
      const response = await this.call('GET', '/mock/providers', null);
      if (response.status !== 200) return { reachable: response.status > 0, schemaVersion: null, scenarios: null };
      const providers = (response.body.providers ?? []) as Array<{
        code?: string;
        scenarioMatrix?: Array<{ scenario?: string; supported?: boolean }>;
      }>;
      const scenarios: Record<string, string[]> = {};
      for (const provider of providers) {
        if (!provider.code) continue;
        scenarios[provider.code.toUpperCase()] = (provider.scenarioMatrix ?? [])
          .filter((entry) => entry.supported === true && typeof entry.scenario === 'string')
          .map((entry) => entry.scenario as string);
      }
      return {
        reachable: true,
        schemaVersion: typeof response.body.schemaVersion === 'string' ? response.body.schemaVersion : null,
        scenarios,
      };
    } catch {
      return { reachable: false, schemaVersion: null, scenarios: null };
    }
  }

  async openRun(input: {
    tenantId: string;
    runId: string;
    seed: string;
    scenarioProfile: string;
  }): Promise<{ runToken: string; epoch: string | null }> {
    const response = await this.call('POST', '/mock/control/runs', input.tenantId, {
      tenantId: input.tenantId,
      runId: input.runId,
      seed: input.seed,
      scenarioProfile: input.scenarioProfile,
      fixtureVersion: 'qa-orchestration@1',
    });
    const runToken = str(response.body.runToken);
    if (response.status !== 201 || !runToken) {
      const code = str(obj(response.body.error).code) ?? str(response.body.code) ?? 'sin código';
      throw new Error(`MOCK_RUN_NOT_CREATED:${response.status}:${code}`);
    }
    return { runToken, epoch: str(response.body.epoch) };
  }

  /**
   * Journal completo recorriendo el cursor. Un journal truncado no certifica una campaña: si el mock
   * descartó entradas por retención, `complete` es `false` y la evidencia se declara incompleta.
   */
  async readJournal(tenantId: string, runId: string, maxPages = 200): Promise<MockJournal | null> {
    const entries: MockJournalEntry[] = [];
    let after = 0;
    let totalAppended = 0;
    let dropped = 0;
    for (let page = 0; page < maxPages; page += 1) {
      const response = await this.call(
        'GET',
        `/mock/control/runs/${encodeURIComponent(runId)}/journal?after=${after}&limit=1000`,
        tenantId,
      );
      if (response.status !== 200 || !response.body) return null;
      entries.push(...((response.body.entries ?? []) as MockJournalEntry[]));
      totalAppended = Number(response.body.totalAppended ?? 0);
      dropped = Number(response.body.droppedByRetention ?? 0);
      if (!response.body.hasMore) return { entries, totalAppended, droppedByRetention: dropped, complete: dropped === 0 };
      after = Number(response.body.nextCursor ?? after);
    }
    return { entries, totalAppended, droppedByRetention: dropped, complete: false };
  }

  /**
   * El código más reciente enviado a `to` por `channel` desde `sinceIso`, leído del buzón QA con el
   * token de control. Busca el primer número de 4 a 8 cifras del cuerpo: así es como lo recibe la
   * persona, y no se depende del formato interno de cada plantilla.
   */
  async latestInboxCode(input: { to: string; channel: string; sinceIso: string }): Promise<string | null> {
    const query = new URLSearchParams({ to: input.to, channel: input.channel, limit: '20' });
    const response = await this.call('GET', `/mock/control/inbox?${query.toString()}`, null);
    if (response.status !== 200) return null;
    const messages = (Array.isArray(response.body.messages) ? response.body.messages : []) as Array<{ body?: string; receivedAt?: string }>;
    for (const message of [...messages].reverse()) {
      if ((message.receivedAt ?? '') < input.sinceIso) continue;
      const code = /\b(\d{4,8})\b/.exec(message.body ?? '')?.[1];
      if (code) return code;
    }
    return null;
  }

  /**
   * Anverso, reverso y selfie sintéticos de UNA persona, dibujados por el mock con sus datos. Cada
   * imagen se comprueba: el base64 decodificado debe medir `bytes` y dar `sha256`; una que no cuadra
   * no se sube (la URL firmada exige el tamaño exacto y el backend recalcula el hash).
   */
  async identityImages(tenantId: string, persona: MockIdentityPersona): Promise<MockIdentityImages> {
    if (!this.configured) return { ok: false, reason: 'MOCK_NOT_CONFIGURED' };
    let response: { status: number; body: JsonObject };
    try {
      response = await this.call('POST', '/mock/qa/identity-images', tenantId, persona, 15_000);
    } catch {
      return { ok: false, reason: 'UNREACHABLE' };
    }
    if (response.status !== 200 && response.status !== 201) return { ok: false, reason: `HTTP_${response.status}` };
    const images = {} as Record<MockIdentityImageKind, MockIdentityImage>;
    for (const kind of MOCK_IDENTITY_IMAGE_KINDS) {
      const entry = obj(obj(response.body.images)[kind]);
      const base64 = str(entry.base64);
      if (!base64) return { ok: false, reason: `IMAGE_MISSING:${kind}` };
      const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (bytes.length === 0 || (typeof entry.bytes === 'number' && entry.bytes !== bytes.length))
        return { ok: false, reason: `SIZE_MISMATCH:${kind}` };
      if (typeof entry.sha256 === 'string' && entry.sha256.toLowerCase() !== sha256)
        return { ok: false, reason: `SHA256_MISMATCH:${kind}` };
      images[kind] = { contentType: str(entry.contentType) ?? 'image/jpeg', bytes, sha256 };
    }
    return { ok: true, version: str(response.body.version) ?? 'desconocida', images };
  }

  async closeRun(tenantId: string, runId: string): Promise<void> {
    await this.call('DELETE', `/mock/control/runs/${encodeURIComponent(runId)}`, tenantId).catch(() => undefined);
  }
}
