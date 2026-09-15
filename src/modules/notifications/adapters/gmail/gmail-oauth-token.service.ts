/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { Injectable } from '@nestjs/common';
import { ResilientAdapterExecutorService } from '../../../../common/resilience/resilient-adapter-executor.service.js';
import { postForm } from '../http-adapter.util.js';

export const GMAIL_TOKEN_PROVIDER = 'gmail_api_token';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Margen sobre `expires_in` para no usar jamás un access token al borde de expirar. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
/** Google devuelve `expires_in` siempre, pero un token sin TTL declarado se asume de 1h (su default). */
const DEFAULT_TOKEN_TTL_SECONDS = 3600;

export type GmailOAuthCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

export class GmailOAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly response: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'GmailOAuthError';
  }
}

/**
 * Canjea el refresh token de larga vida por un access token de Gmail y lo cachea en memoria.
 *
 * El canje es la mitad del costo de cada envío si se hace por mensaje: una notificación por correo
 * pasaba a ser dos llamadas salientes a Google, y un lote de N correos gastaba N canjes contra la
 * cuota de OAuth de un token cuyo TTL real es de una hora. Aquí el canje ocurre una vez por hora y
 * los envíos concurrentes comparten la misma promesa en vuelo, de modo que un arranque en frío con
 * varios correos simultáneos tampoco dispara N refrescos en paralelo.
 *
 * El token NO se persiste ni se loguea: vive solo en el proceso y se descarta al reiniciar.
 */
@Injectable()
export class GmailOAuthTokenService {
  private cached: { value: string; expiresAtMs: number } | null = null;
  private inFlight: Promise<string> | null = null;

  constructor(private readonly executor: ResilientAdapterExecutorService) {}

  async getAccessToken(credentials: GmailOAuthCredentials): Promise<string> {
    const cached = this.cached;
    if (cached && cached.expiresAtMs > Date.now()) return cached.value;

    const inFlight = this.inFlight;
    if (inFlight) return inFlight;

    const refresh = this.requestAccessToken(credentials).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = refresh;
    return refresh;
  }

  /**
   * Descarta el token cacheado. Lo llama el adaptador cuando Gmail responde 401: el token pudo ser
   * revocado antes de expirar (cambio de contraseña, retiro del consentimiento), y sin esto el
   * proceso reintentaría con el mismo token muerto hasta que el TTL cacheado venciera.
   */
  invalidate(): void {
    this.cached = null;
  }

  private async requestAccessToken(credentials: GmailOAuthCredentials): Promise<string> {
    // Google documenta este endpoint como `application/x-www-form-urlencoded`; se usa `postForm`
    // por contrato, no por preferencia.
    const response = await postForm(
      this.executor,
      GMAIL_TOKEN_PROVIDER,
      GOOGLE_TOKEN_URL,
      {},
      {
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: 'refresh_token',
      },
    );

    const accessToken = response.json.access_token;
    if (!response.ok || typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new GmailOAuthError(
        'GMAIL_TOKEN_FAILED',
        `Google OAuth respondió HTTP ${response.status} al refrescar el access token de Gmail.`,
        response.json,
      );
    }

    const ttlSeconds = typeof response.json.expires_in === 'number' ? response.json.expires_in : DEFAULT_TOKEN_TTL_SECONDS;
    this.cached = { value: accessToken, expiresAtMs: Date.now() + Math.max(0, ttlSeconds * 1000 - TOKEN_EXPIRY_MARGIN_MS) };
    return accessToken;
  }
}
