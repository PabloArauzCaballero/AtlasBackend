/**
 * @file Adaptador HTTP firmado que entrega un sobre de Core a otro servicio (P-14).
 * @business Un evento sólo cuenta como entregado si el receptor confirmó DESPUÉS de registrarlo en su
 *   inbox (2xx). Un timeout, una red caída o un 5xx no son entrega: se reintenta. Un 4xx de contrato
 *   (400/410/413/415/422) no cambia reintentando: va a `dead`, visible.
 * @system Misma clasificación y misma firma que `HttpEventPublisher` del ERP, para que haya un solo
 *   esquema en los dos sentidos. 401/403/404 se tratan como configuración (secreto rotado, receptor sin
 *   desplegar) y se reintentan. El cuerpo de la respuesta nunca se guarda (puede traer datos).
 */
import { ATTEMPT_HEADER, EVENT_KEY_HEADER, SIGNATURE_HEADER, TOPIC_HEADER, signEventBody } from '../../platform/security/signed-event.js';

export type DeliveryResult =
  | { outcome: 'ACK'; httpStatus: number }
  | { outcome: 'RETRY'; httpStatus: number | null; error: string }
  | { outcome: 'REJECTED'; httpStatus: number; error: string };

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const REJECTED_STATUSES = new Set([400, 410, 413, 415, 422]);

export type SignedEventPublisherOptions = Readonly<{
  url: string;
  secret: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  nowSeconds?: () => number;
}>;

/** Error apto para `last_error`: sin credenciales ni query de la URL, sin el secreto, truncado. */
export function redactDeliveryError(message: string, secret: string): string {
  return message
    .replace(/(https?:\/\/)([^\s/]*@)?([^\s/?#]+)[^\s]*/giu, '$1$3/…')
    .split(secret)
    .join('[secreto]')
    .replace(/\bv1=[0-9a-f]+/giu, 'v1=[redactado]')
    .slice(0, 300);
}

export class SignedEventPublisher {
  private readonly fetchImpl: FetchLike;
  private readonly nowSeconds: () => number;

  constructor(private readonly options: SignedEventPublisherOptions) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  async publish(envelope: { eventKey: string; topic: string }, attempt: number): Promise<DeliveryResult> {
    const rawBody = JSON.stringify(envelope);
    let response: Response;
    try {
      response = await this.fetchImpl(this.options.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [EVENT_KEY_HEADER]: envelope.eventKey,
          [TOPIC_HEADER]: envelope.topic,
          [ATTEMPT_HEADER]: String(attempt),
          [SIGNATURE_HEADER]: signEventBody(this.options.secret, rawBody, this.nowSeconds()),
        },
        body: rawBody,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      return { outcome: 'RETRY', httpStatus: null, error: this.describe(error) };
    }
    await response.body?.cancel().catch(() => undefined);
    if (response.status >= 200 && response.status < 300) return { outcome: 'ACK', httpStatus: response.status };
    const error = `HTTP ${response.status} del receptor`;
    if (REJECTED_STATUSES.has(response.status)) return { outcome: 'REJECTED', httpStatus: response.status, error };
    return { outcome: 'RETRY', httpStatus: response.status, error };
  }

  private describe(error: unknown): string {
    const top = (typeof error === 'object' && error !== null ? error : {}) as { name?: string; message?: string; cause?: unknown };
    const cause = (typeof top.cause === 'object' && top.cause !== null ? top.cause : {}) as {
      name?: string;
      code?: string;
      message?: string;
    };
    if ([top.name, cause.name].some((name) => name === 'TimeoutError' || name === 'AbortError')) {
      return `timeout: sin respuesta del receptor en ${this.options.timeoutMs} ms`;
    }
    const detail = cause.name ? `${cause.name}: ${cause.code ?? cause.message ?? ''}` : (top.message ?? String(error));
    return redactDeliveryError(`red: ${detail}`, this.options.secret);
  }
}
