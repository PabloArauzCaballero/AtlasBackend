/**
 * @file Adaptador de infraestructura: transporte HTTP, admisión y presupuesto del worker QA.
 * @business Esta pieza envía las peticiones de las personas al backend QA respetando cupos,
 *   presupuesto de solicitudes, peticiones en vuelo y el plazo total de la corrida.
 * @system implementaciones de los puertos del ejecutor; el destino lo fija el servidor.
 *
 * Límites y su alcance, dichos sin adornos: una corrida la ejecuta UN worker a la vez (lease de la
 * cola), así que el presupuesto y el tope en vuelo de ESTA corrida son globales para ella aunque
 * vivan en memoria. Lo que no coordinan es la suma de varias corridas en varios workers; eso lo
 * acota la admisión (una corrida activa por tenant, ver `QaRunOrchestratorService`).
 */
import { AdmissionGate } from './admission-gate.js';
import type { AdmissionPort, BudgetPort, QaTransport, TransportRequest, TransportResponse } from '../application/executor.ports.js';

export class QaHttpTransport implements QaTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly tenantId: string,
  ) {}

  async send(request: TransportRequest): Promise<TransportResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    const abort = () => controller.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    const started = performance.now();
    const query = request.query ? `?${new URLSearchParams(request.query).toString()}` : '';
    try {
      // Una subida va a la URL firmada con sus propias cabeceras: ni tenant, ni sesión, ni credencial QA.
      const url = request.absoluteUrl ?? `${this.baseUrl.replace(/\/+$/, '')}${request.path}${query}`;
      const headers = request.absoluteUrl
        ? request.headers
        : { 'content-type': 'application/json', 'x-tenant-id': this.tenantId, ...request.headers };
      const jsonBody =
        request.method === 'GET' || request.method === 'DELETE' || request.body === undefined ? undefined : JSON.stringify(request.body);
      const response = await fetch(url, { method: request.method, headers, body: request.rawBody ?? jsonBody, signal: controller.signal });
      const text = await response.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { nonJsonBody: text.slice(0, 200) };
      }
      return { status: response.status, body, latencyMs: performance.now() - started };
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      return {
        status: null,
        error:
          name === 'AbortError' ? (request.signal.aborted ? 'CANCELLED' : 'TIMEOUT') : error instanceof Error ? error.message : 'UNKNOWN',
        latencyMs: performance.now() - started,
      };
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
    }
  }
}

/** Un cubo por endpoint limitado, con el cupo que su controlador declara. */
export class BucketAdmission implements AdmissionPort {
  private readonly gates = new Map<string, AdmissionGate>();

  async admit(bucket: string, perMinute: number, signal: AbortSignal): Promise<{ admissionLagMs: number }> {
    let gate = this.gates.get(bucket);
    if (!gate) {
      gate = new AdmissionGate(Math.max(1, perMinute), 60_000);
      this.gates.set(bucket, gate);
    }
    return gate.admit(signal);
  }
}

/**
 * Presupuesto de la corrida: reserva ANTES de enviar. Agotado el total, vencido el plazo o
 * cancelada la corrida, no sale ni una petición más; las que ya salieron se reconcilian.
 */
export class RunBudget implements BudgetPort {
  private issued = 0;
  private inFlight = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly limits: { maxRequests: number; maxInFlightRequests: number; deadlineAt: number },
    private readonly signal: AbortSignal,
  ) {}

  get requestsIssued(): number {
    return this.issued;
  }

  get exhausted(): 'BUDGET_EXHAUSTED' | 'DEADLINE_EXCEEDED' | null {
    if (this.issued >= this.limits.maxRequests) return 'BUDGET_EXHAUSTED';
    if (Date.now() >= this.limits.deadlineAt) return 'DEADLINE_EXCEEDED';
    return null;
  }

  async acquire() {
    for (;;) {
      if (this.signal.aborted) return { ok: false as const, reason: 'CANCELLED' as const };
      const reason = this.exhausted;
      if (reason) return { ok: false as const, reason };
      if (this.inFlight < this.limits.maxInFlightRequests) break;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.issued += 1;
    this.inFlight += 1;
    let released = false;
    return {
      ok: true as const,
      release: () => {
        if (released) return;
        released = true;
        this.inFlight -= 1;
        this.waiters.shift()?.();
      },
    };
  }

  /** Despierta a quien espera cupo para que observe la cancelación o el plazo vencido. */
  wakeAll(): void {
    while (this.waiters.length > 0) this.waiters.shift()?.();
  }
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}
