/**
 * @file Puerto de salida hacia el worker de autenticación: encapsula el transporte y los errores.
 * @business Esta pieza incorpora evidencia KYC, financiera y de confianza con control de costo, consentimiento y disponibilidad.
 * @system aísla proveedores detrás de adaptadores resilientes y políticas de gobierno, ejecución y evidencia.
 */
import { HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import {
  AuthBrokerAvailability,
  ProviderAuthState,
  ProviderCredentialRevocationResult,
  ProviderCredentialRotationResult,
} from './auth-broker.types.js';

/**
 * Cliente del `atlas-auth-broker-worker`.
 *
 * Existe para que ningún otro archivo del backend vuelva a leer un `*_CLIENT_SECRET`: la
 * autenticación con proveedores externos deja de ser configuración local y pasa a ser una
 * capacidad de un servicio especializado.
 *
 * Falla ABIERTO en las lecturas de estado (si el broker no responde, el portal muestra
 * "inalcanzable" y el resto del panel sigue funcionando) y CERRADO en `authorize` (sin token no
 * hay llamada al proveedor). Esa asimetría es deliberada: un panel a medias es un inconveniente;
 * una llamada a un buró de crédito sin autenticar es un incidente.
 */
@Injectable()
export class AuthBrokerClient {
  private readonly logger = new Logger(AuthBrokerClient.name);

  private readonly baseUrl = process.env.AUTH_BROKER_BASE_URL?.trim();
  private readonly serviceToken = process.env.AUTH_BROKER_SERVICE_TOKEN?.trim();
  private readonly timeoutMs = Number(process.env.AUTH_BROKER_TIMEOUT_MS ?? 8000);

  private static readonly authStateSchema = z.object({
    providerCode: z.string(),
    authMethod: z.enum(['oauth2_client_credentials', 'jwt_bearer', 'mtls', 'api_key', 'none']),
    credentialStatus: z.enum(['ACTIVE', 'MISSING', 'EXPIRED', 'ROTATION_DUE', 'REVOKED', 'NOT_REQUIRED']),
    tokenStatus: z.enum(['VALID', 'EXPIRING', 'EXPIRED', 'NONE', 'REFRESH_FAILED']),
    credentialFingerprint: z.string().optional(),
    scopes: z.array(z.string()).default([]),
    issuedAt: z.string().optional(),
    rotatedAt: z.string().optional(),
    rotationDueAt: z.string().optional(),
    credentialAgeDays: z.number().optional(),
    tokenExpiresAt: z.string().optional(),
    lastRefreshAt: z.string().optional(),
    lastFailureCode: z.string().optional(),
    lastFailureAt: z.string().optional(),
  });

  private static readonly errorSchema = z.object({ code: z.string(), message: z.string() });

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.serviceToken);
  }

  /**
   * Cabeceras con las que un adaptador autentica su llamada al proveedor.
   *
   * El valor devuelto contiene un token real: no debe registrarse, ni persistirse, ni reenviarse
   * al portal. Se usa y se descarta.
   */
  async authorize(providerCode: string): Promise<Record<string, string>> {
    const response = await this.call<{ headers: Record<string, string> }>(
      'POST',
      `/outbound/providers/${encodeURIComponent(providerCode)}/authorize`,
      z.object({ headers: z.record(z.string(), z.string()) }),
    );
    return response.headers;
  }

  listAuthStates(): Promise<ProviderAuthState[]> {
    return this.call('GET', '/outbound/providers/auth-state', z.object({ providers: z.array(AuthBrokerClient.authStateSchema) })).then(
      (body) => body.providers,
    );
  }

  authStateFor(providerCode: string): Promise<ProviderAuthState> {
    return this.call('GET', `/outbound/providers/${encodeURIComponent(providerCode)}/auth-state`, AuthBrokerClient.authStateSchema);
  }

  pendingRotation(): Promise<ProviderAuthState[]> {
    return this.call(
      'GET',
      '/outbound/credentials/pending-rotation',
      z.object({ credentials: z.array(AuthBrokerClient.authStateSchema) }),
    ).then((body) => body.credentials);
  }

  rotateCredential(providerCode: string, field: string, material: string): Promise<ProviderCredentialRotationResult> {
    return this.call(
      'POST',
      `/outbound/providers/${encodeURIComponent(providerCode)}/rotate`,
      z.object({
        providerCode: z.string(),
        field: z.string(),
        fingerprint: z.string(),
        rotatedAt: z.string(),
      }),
      { field, material },
    );
  }

  revokeCredential(providerCode: string, reason: string): Promise<ProviderCredentialRevocationResult> {
    return this.call('POST', `/outbound/providers/${encodeURIComponent(providerCode)}/revoke`, z.object({ revokedAt: z.string() }), {
      reason,
    });
  }

  invalidateToken(providerCode: string): Promise<{ providerCode: string; invalidated: boolean }> {
    return this.call(
      'POST',
      `/outbound/providers/${encodeURIComponent(providerCode)}/invalidate-token`,
      z.object({ providerCode: z.string(), invalidated: z.boolean() }),
      {},
    );
  }

  /**
   * Disponibilidad del broker. NO lanza: es la única operación que el portal consulta para saber
   * si el resto de la vista tiene sentido, y un throw aquí dejaría la pantalla en blanco.
   */
  async availability(): Promise<AuthBrokerAvailability> {
    if (!this.isConfigured()) return { configured: false, reachable: false };
    try {
      const body = await this.call('GET', '/health/ready', z.object({ status: z.string(), vaultDriver: z.string().optional() }));
      return { configured: true, reachable: true, ...(body.vaultDriver ? { vaultDriver: body.vaultDriver } : {}) };
    } catch (error) {
      return {
        configured: true,
        reachable: false,
        errorCode: error instanceof HttpException ? String(error.getStatus()) : 'UNREACHABLE',
      };
    }
  }

  private async call<T>(method: 'GET' | 'POST', path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    if (!this.baseUrl || !this.serviceToken) {
      throw new ServiceUnavailableException('AUTH_BROKER_NOT_CONFIGURED: falta AUTH_BROKER_BASE_URL o AUTH_BROKER_SERVICE_TOKEN.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.serviceToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch {
      // El detalle del fallo de red puede arrastrar la URL con el token en algunos runtimes:
      // se registra el destino lógico, nunca el error crudo.
      this.logger.error(`El broker de autenticación no respondió (${method} ${path}).`);
      throw new ServiceUnavailableException('AUTH_BROKER_UNREACHABLE');
    } finally {
      clearTimeout(timer);
    }

    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const parsed = AuthBrokerClient.errorSchema.safeParse(payload);
      const code = parsed.success ? parsed.data.code : 'AUTH_BROKER_ERROR';
      const message = parsed.success ? parsed.data.message : 'El broker de autenticación devolvió un error.';
      this.logger.warn(`Broker de autenticación: ${code} (${method} ${path}).`);
      throw new HttpException({ code, message }, response.status);
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      this.logger.error(`El broker de autenticación devolvió un cuerpo fuera de contrato (${method} ${path}).`);
      throw new ServiceUnavailableException('AUTH_BROKER_CONTRACT_MISMATCH');
    }
    return parsed.data;
  }
}
