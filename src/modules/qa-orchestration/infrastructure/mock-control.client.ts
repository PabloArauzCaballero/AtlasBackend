/**
 * @file Adaptador de infraestructura: plano de control del emulador de proveedores.
 * @business Esta pieza da a cada corrida su propio namespace en el mock y lee su journal COMPLETO,
 *   que es la prueba de que el tráfico salió por la red y no por un `fetch` interceptado.
 * @system HTTP contra `/mock/control/*` con el token de administración; nunca expone el runToken.
 *
 * Contrato confirmado contra `AtlasExternalProvidersMock@origin/dev` (`src/control/routes.mjs`):
 * `POST /mock/control/runs` → 201 `{ runToken, epoch, … }`; `GET …/runs/:runId/journal?after&limit`
 * con cursor (`nextCursor`, `hasMore`, `totalAppended`, `droppedByRetention`), `limit` ≤ 1000;
 * `DELETE …/runs/:runId`; `GET /mock/providers` con la matriz proveedor × escenario.
 */

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

export type MockJournal = { entries: MockJournalEntry[]; totalAppended: number; droppedByRetention: number; complete: boolean };

export class MockControlClient {
  constructor(private readonly options: { controlUrl: string | undefined; controlToken: string | undefined; timeoutMs?: number }) {}

  get configured(): boolean {
    return Boolean(this.options.controlUrl && this.options.controlToken);
  }

  private async call(method: string, path: string, tenantId: string | null, body?: unknown): Promise<{ status: number; body: JsonObject }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 5_000);
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

  async closeRun(tenantId: string, runId: string): Promise<void> {
    await this.call('DELETE', `/mock/control/runs/${encodeURIComponent(runId)}`, tenantId).catch(() => undefined);
  }
}
