/**
 * @file Directorio de destinatarios por HTTP para el worker de Mensajería (AT-057).
 * @business Fuera del monolito, Mensajería pregunta a Clientes por HTTP con su identidad de servicio y
 *   trata cualquier fallo como «no entregable» (nunca inventa una dirección ni reintenta a ciegas).
 * @system Implementa `RecipientDirectoryPort` contra `internal/contexts/customers/recipient-directory`:
 *   token de servicio por llamada (60 s, tenant en el token), `fetch` con tiempo límite; cualquier
 *   error o respuesta no 2xx → `unsupported`/vacío y aviso en el log (fail closed).
 */
import { Logger } from '@nestjs/common';
import type {
  DeliveryAddress,
  DeliveryAddressLookup,
  RecipientDirectoryPort,
  RecipientLookup,
  RecipientResolution,
} from '../../../../platform/contracts/recipient-directory.js';
import { resourceFingerprint, signServiceToken } from '../../../../platform/security/service-token.js';

export const RECIPIENT_DIRECTORY_HTTP_TIMEOUT_MS = 3000;

export type HttpRecipientDirectoryOptions = Readonly<{
  /** Base de la API con prefijo, p. ej. `http://api:3005/api/v1`. */
  baseUrl: string;
  service: string;
  scope: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  secret?: string;
}>;

export class HttpRecipientDirectoryAdapter implements RecipientDirectoryPort {
  private readonly logger = new Logger(HttpRecipientDirectoryAdapter.name);

  constructor(private readonly options: HttpRecipientDirectoryOptions) {}

  async resolve(lookup: RecipientLookup): Promise<RecipientResolution> {
    const fallback: RecipientResolution = Object.freeze({ status: 'unsupported', contactId: null, resolvedAt: new Date().toISOString() });
    if (lookup.recipient.type !== 'customer') return fallback;
    const body = await this.get<RecipientResolution>('resolve', lookup.tenantId, {
      customerId: lookup.recipient.id,
      channel: lookup.channel,
    });
    return body ?? fallback;
  }

  async resolveDeliveryAddresses(lookup: DeliveryAddressLookup): Promise<readonly DeliveryAddress[]> {
    if (lookup.recipient.type !== 'customer') return [];
    const body = await this.get<{ addresses: DeliveryAddress[] }>('addresses', lookup.tenantId, {
      customerId: lookup.recipient.id,
      channel: lookup.channel,
      purpose: lookup.purpose,
    });
    return Object.freeze(body?.addresses ?? []);
  }

  private async get<T>(path: string, tenantId: string, query: Record<string, string>): Promise<T | null> {
    const url = new URL(`${this.options.baseUrl.replace(/\/+$/, '')}/internal/contexts/customers/recipient-directory/${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? RECIPIENT_DIRECTORY_HTTP_TIMEOUT_MS);
    try {
      // El token vale sólo para ESTA consulta: la huella lleva el mismo juego de parámetros que el
      // controlador exige, así que capturarlo no permite enumerar otros clientes (hallazgo A7).
      const token = signServiceToken({
        service: this.options.service,
        tenantId,
        scopes: [this.options.scope],
        audienceContext: 'customers',
        resource: resourceFingerprint(query),
        secret: this.options.secret,
      });
      const response = await (this.options.fetchImpl ?? fetch)(url, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn(`RECIPIENT_DIRECTORY_HTTP_${response.status}: ${path} (tenant ${tenantId}); se trata como no entregable.`);
        return null;
      }
      const envelope = (await response.json()) as { data?: T } & T;
      // La API envuelve las respuestas de éxito en `data` (sobre global); se acepta con o sin sobre.
      return (envelope.data ?? envelope) as T;
    } catch (error) {
      this.logger.warn(
        `RECIPIENT_DIRECTORY_HTTP_FAILED: ${path}: ${error instanceof Error ? error.message : String(error)}; se trata como no entregable.`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
