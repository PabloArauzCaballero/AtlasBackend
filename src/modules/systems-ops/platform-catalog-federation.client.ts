/**
 * @file Adaptador de infraestructura: habla con un sistema externo y traduce sus fallos.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system trae por HTTP el manifiesto que cada bloque del ecosistema publica sobre sí mismo.
 */
import { Injectable, Logger } from '@nestjs/common';
import { manifestConfigFor } from './platform-blocks.constants.js';
import { catalogManifestSchema, CatalogManifest, FederationStatus } from './platform-catalog-manifest.types.js';

export type ManifestFetchResult =
  | { readonly ok: true; readonly manifest: CatalogManifest }
  | { readonly ok: false; readonly status: Exclude<FederationStatus, 'OK'>; readonly message: string };

/**
 * Trae el manifiesto de un bloque y traduce cada forma de fallar a un desenlace con nombre.
 *
 * Los cinco desenlaces se distinguen a propósito porque exigen acciones distintas de personas
 * distintas: sin dirección o sin llave es un hueco de DESPLIEGUE (nadie dijo dónde ni con qué);
 * un 401/403 es una credencial equivocada o caducada; un fallo de red es el servicio sin contestar;
 * un manifiesto con la forma cambiada es una ruptura de contrato entre repositorios. Colapsarlos
 * todos en «no se pudo» obligaría al operador a abrir tres consolas para averiguar cuál era.
 *
 * No hay reintentos ni circuito: esto corre bajo demanda o cada varios minutos, nunca en el camino
 * de una petición de negocio, y un reintento aquí sólo alargaría el tiempo hasta que el panel
 * pueda decir la verdad sobre el bloque.
 */
@Injectable()
export class PlatformCatalogFederationClient {
  private readonly logger = new Logger(PlatformCatalogFederationClient.name);

  async fetchManifest(systemCode: string): Promise<ManifestFetchResult> {
    const config = manifestConfigFor(systemCode);
    if (!config) {
      return { ok: false, status: 'ERROR', message: `El bloque ${systemCode} no declara cómo alcanzar su manifiesto.` };
    }
    if (!config.baseUrl) {
      return {
        ok: false,
        status: 'NOT_CONFIGURED',
        message:
          `El bloque ${systemCode} no tiene dirección configurada en este despliegue, así que no hay a quién ` +
          'pedirle su catálogo. No es lo mismo que estar vacío: nadie ha dicho dónde buscarlo.',
      };
    }
    if (!config.authValue) {
      return {
        ok: false,
        status: 'NOT_CONFIGURED',
        message:
          `El bloque ${systemCode} tiene dirección pero no credencial de catálogo. El manifiesto enumera rutas y ` +
          'tablas del servicio, así que se pide con identidad o no se pide.',
      };
    }

    const url = joinUrl(config.baseUrl, config.manifestPath);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json', [config.authHeader]: config.authValue, ...config.extraHeaders },
        signal: controller.signal,
      });
      const elapsed = Date.now() - startedAt;

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          status: 'UNAUTHORIZED',
          message: `${systemCode} rechazó la credencial de catálogo con HTTP ${response.status} en ${url}. La llave existe pero no vale.`,
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          status: 'UNREACHABLE',
          message: `${systemCode} respondió HTTP ${response.status} en ${url} (${elapsed} ms) al pedirle su manifiesto.`,
        };
      }

      const body: unknown = await response.json().catch(() => null);
      const parsed = catalogManifestSchema.safeParse(unwrapEnvelope(body));
      if (!parsed.success) {
        const detail = parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
          .join('; ');
        return {
          ok: false,
          status: 'INVALID_MANIFEST',
          message: `${systemCode} contestó con una forma que este catálogo no reconoce (${detail}).`,
        };
      }
      this.logger.log(`Manifiesto de ${systemCode} recibido en ${elapsed} ms desde ${url}.`);
      return { ok: true, manifest: parsed.data };
    } catch (error) {
      const elapsed = Date.now() - startedAt;
      const motivo =
        error instanceof Error && error.name === 'AbortError'
          ? `no respondió en ${config.timeoutMs} ms`
          : `no se pudo contactar (${error instanceof Error ? error.message : 'error desconocido'})`;
      return { ok: false, status: 'UNREACHABLE', message: `${systemCode} ${motivo} en ${url} tras ${elapsed} ms.` };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Saca el manifiesto del sobre de respuesta del bloque, si lo trae.
 *
 * El ERP envuelve TODA respuesta en `{ success, data }` con un interceptor global; el motor de
 * decisión devuelve el cuerpo desnudo. Exigirle a uno de los dos que cambie su convención de
 * transporte para poder publicar un manifiesto sería pedirle que rompa el contrato de sus
 * clientes reales por comodidad de este consumidor, así que la asimetría se absorbe aquí, en el
 * único sitio que la conoce.
 *
 * Se desenvuelve sólo cuando `data` parece el manifiesto —trae `block`—, para no confundir un
 * sobre con un manifiesto que legítimamente tuviera un campo llamado `data`.
 */
function unwrapEnvelope(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const envelope = body as { data?: unknown; block?: unknown };
  if (envelope.block !== undefined) return body;
  const inner = envelope.data;
  if (inner && typeof inner === 'object' && 'block' in inner) return inner;
  return body;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
