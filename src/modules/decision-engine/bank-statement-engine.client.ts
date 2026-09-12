/**
 * @file Adaptador de infraestructura: habla con un sistema externo y traduce sus fallos.
 * @business Esta pieza consigue que el extracto del cliente lo lea el sistema que sabe leerlo.
 * @system sube el PDF al worker de extractos del motor y espera su veredicto de admisión y capacidad.
 */
import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env.js';

/**
 * El worker de extractos del motor, visto desde el core.
 *
 * ## Por qué esto sustituye a un lector propio
 *
 * Aquí había un lector de extractos escrito a mano: buscaba las palabras «abono» y «cargo» en el
 * texto del PDF, sumaba los números de esas líneas y devolvía un ingreso y un gasto. Tenía tres
 * defectos que no se arreglan afinándolo:
 *
 * 1. **No sabía de quién era el documento.** Cualquier PDF con una tabla de fechas e importes
 *    producía un ingreso, incluida la factura de una telefónica o un extracto compuesto en Word.
 * 2. **Sumaba todo lo que entraba.** Un traspaso desde la caja de ahorro del propio titular contaba
 *    como ingreso, igual que el desembolso de un préstamo.
 * 3. **Miraba un solo periodo, fuera el que fuera.** Un mes con el aguinaldo dentro decía que la
 *    persona gana el doble de lo que gana.
 *
 * El motor ya resuelve las tres: tiene el padrón de ASFI, siete analizadores verificados, las tres
 * compuertas de admisión y un algoritmo de capacidad de pago que exige tres meses completos. Dos
 * implementaciones de la misma regla acaban discrepando, y el día que discrepan nadie sabe cuál de
 * las dos decidió. Así que aquí no queda ninguna.
 *
 * ## El protocolo, y por qué es en dos tiempos
 *
 * El worker responde `202` al recibir el archivo y procesa aparte. Aquí se sube, se sondea y se
 * devuelve el desenlace. No se sostiene una petición HTTP abierta mientras se lee un PDF: es
 * exactamente lo que un worker existe para evitar.
 */

/** Estados terminales del worker, tal como los publica el motor. */
const TERMINALES = new Set(['SUCCEEDED', 'SUCCEEDED_WITH_WARNINGS', 'FAILED', 'CANCELLED', 'PDF_INVALID', 'PENDING_REVIEW', 'IN_REVIEW']);

/** Lo que el motor concluyó sobre un extracto. */
export type StatementOutcome =
  /** Se leyó y hay capacidad de pago calculada. */
  | { kind: 'analyzed'; run: StatementRun }
  /** El motor lo rechazó, con su motivo. Es un desenlace de negocio, no un fallo. */
  | { kind: 'rejected'; run: StatementRun }
  /** El motor lo derivó a una persona: hay duda real sobre el documento. */
  | { kind: 'review'; run: StatementRun }
  /** No se pudo preguntar. NO dice nada del documento y se reintenta. */
  | { kind: 'engineUnavailable'; reason: string };

export interface StatementRun {
  requestId: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  rejectionReason: string | null;
  reviewReason: string | null;
  /** `NormalizedBankStatement` del motor, con `affordability` y `authenticity` dentro. */
  result: StatementResult | null;
}

export interface StatementResult {
  institution?: { id?: string | null; name?: string | null } | null;
  period?: { from?: string | null; to?: string | null } | null;
  totals?: { debitExtracted?: number; creditExtracted?: number } | null;
  authenticity?: { verdict?: string; suspicionScore?: number } | null;
  affordability?: StatementAffordability | null;
}

/** Sólo lo que el core consume. El contrato completo vive en el motor. */
export interface StatementAffordability {
  eligible?: boolean;
  score?: number;
  band?: string;
  modelVersion?: string;
  coverage?: { monthsComplete?: number; minimumMonthsRequired?: number; from?: string | null; to?: string | null };
  income?: { monthlyRecognized?: number; stressed?: number; stabilityScore?: number; variability?: number; trend?: number };
  expenses?: { effectiveMonthly?: number; committedMonthly?: number; trend?: number };
  obligations?: { monthly?: number; debtServiceRatio?: number; trend?: number };
  capacity?: {
    disposableIncome?: number;
    stressedDisposableIncome?: number;
    maxAffordableInstallment?: number;
    bindingConstraint?: string;
  };
  signals?: {
    nsfEvents?: number;
    nsfMonths?: number;
    monthsEndingNegative?: number;
    highRiskMonths?: number;
    creditDisbursementsReceived?: number;
    collectionActions?: number;
  };
  reasons?: { code?: string; severity?: string; message?: string; evidence?: string }[];
}

const PROVIDER = 'atlas_decision_engine_statements';

@Injectable()
export class BankStatementEngineClient {
  private readonly logger = new Logger(BankStatementEngineClient.name);

  /** Sin motor no hay lectura de extractos, y quien llame debe poder distinguirlo de un fallo. */
  get isConfigured(): boolean {
    return Boolean(env.DECISION_ENGINE_BASE_URL && this.apiKey());
  }

  /**
   * Manda el extracto y espera el veredicto.
   *
   * Devuelve `engineUnavailable` —y no un rechazo— ante cualquier fallo de transporte. Es la
   * distinción que sostiene todo el flujo: un motor caído no es un extracto inválido, y convertirlo
   * en uno le diría al cliente que su documento no sirve por una avería que es nuestra.
   */
  async analyze(input: { fileName: string; bytes: Buffer; correlationId?: string }): Promise<StatementOutcome> {
    if (!this.isConfigured) {
      return { kind: 'engineUnavailable', reason: 'El motor de extractos no está configurado.' };
    }

    let queued: StatementRun;
    try {
      queued = await this.upload(input);
    } catch (error) {
      return { kind: 'engineUnavailable', reason: `No se pudo encolar el extracto: ${message(error)}` };
    }

    let run = queued;
    const deadline = Date.now() + env.DECISION_ENGINE_STATEMENT_MAX_WAIT_MS;
    while (!TERMINALES.has(run.status)) {
      if (Date.now() >= deadline) {
        /*
         * Agotar la espera NO cierra el caso. La ejecución sigue viva en el motor y la revisión se
         * queda como estaba, así que el siguiente barrido vuelve a intentarlo y encontrará el
         * resultado ya hecho —el motor deduplica por huella del archivo—. Cerrarla aquí como fallo
         * tiraría un trabajo que probablemente ya terminó.
         */
        return {
          kind: 'engineUnavailable',
          reason: `El motor no terminó en ${String(env.DECISION_ENGINE_STATEMENT_MAX_WAIT_MS)} ms; sigue en ${run.status}.`,
        };
      }
      await sleep(env.DECISION_ENGINE_STATEMENT_POLL_MS);
      try {
        run = await this.fetchRun(queued.requestId);
      } catch (error) {
        return { kind: 'engineUnavailable', reason: `No se pudo consultar el extracto: ${message(error)}` };
      }
    }

    if (run.status === 'PDF_INVALID') return { kind: 'rejected', run };
    if (run.status === 'PENDING_REVIEW' || run.status === 'IN_REVIEW') return { kind: 'review', run };
    if (run.status === 'FAILED' || run.status === 'CANCELLED') {
      return { kind: 'engineUnavailable', reason: run.errorMessage ?? `El motor terminó en ${run.status}.` };
    }
    return { kind: 'analyzed', run };
  }

  /**
   * Sube el archivo como `multipart/form-data`, que es lo que el worker acepta.
   *
   * Se arma con `FormData` y `Blob` nativos —Node 18+ los trae— en vez de con una dependencia de
   * multipart: son cuatro líneas y una dependencia menos en la ruta por la que viaja el documento
   * más sensible del expediente.
   */
  private async upload(input: { fileName: string; bytes: Buffer; correlationId?: string }): Promise<StatementRun> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(input.bytes)], { type: 'application/pdf' }), input.fileName);

    const response = await this.send(`${this.baseUrl()}/v1/workers/bank-statement/runs`, {
      method: 'POST',
      body: form,
      correlationId: input.correlationId,
    });
    return toRun(response);
  }

  private async fetchRun(requestId: string): Promise<StatementRun> {
    const response = await this.send(`${this.baseUrl()}/v1/workers/bank-statement/runs/${encodeURIComponent(requestId)}`, {
      method: 'GET',
    });
    return toRun(response);
  }

  private async send(
    url: string,
    /*
     * `FormData` y no `BodyInit`: el tipo global de `fetch` no está declarado en la configuración de
     * tipos de este proyecto, y la única forma de cuerpo que esta clase manda es un formulario
     * multiparte. Escribir el tipo concreto es más honesto que ampliar la declaración global por una
     * llamada.
     */
    options: { method: string; body?: FormData; correlationId?: string },
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.DECISION_ENGINE_STATEMENT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: options.method,
        headers: {
          'x-api-key': this.apiKey(),
          // El motor es multi-tenant y su guardián exige la cabecera; el core habla siempre con el
          // tenant 1 de la instalación, igual que en el listado de artefactos.
          'x-tenant-id': '1',
          accept: 'application/json',
          ...(options.correlationId ? { 'x-request-id': options.correlationId } : {}),
        },
        body: options.body,
        signal: controller.signal,
      });
      const text = await response.text().catch(() => '');
      if (!response.ok) {
        throw new Error(`HTTP ${String(response.status)} ${text.slice(0, 300)}`);
      }
      return text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * La llave del worker de extractos, con su cascada.
   *
   * Cae a la de gobierno —que ya es del plano de gestión— y NUNCA a la de ejecución: la de ejecución
   * es la que decide, y dejarle además subir documentos de clientes le daría al componente que
   * decide una capacidad que no necesita.
   */
  private apiKey(): string {
    return env.DECISION_ENGINE_STATEMENT_API_KEY ?? env.DECISION_ENGINE_GOVERNANCE_API_KEY ?? '';
  }

  private baseUrl(): string {
    const base = env.DECISION_ENGINE_BASE_URL;
    if (!base) throw new Error(`${PROVIDER}: DECISION_ENGINE_BASE_URL no está configurada.`);
    return base.replace(/\/+$/, '');
  }
}

function toRun(body: Record<string, unknown>): StatementRun {
  return {
    requestId: String(body.requestId ?? ''),
    status: String(body.status ?? 'QUEUED'),
    errorCode: asString(body.errorCode),
    errorMessage: asString(body.errorMessage),
    rejectionReason: asString(body.rejectionReason),
    reviewReason: asString(body.reviewReason),
    result: (body.result as StatementResult | undefined) ?? null,
  };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
