/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { assertResolvedTargetSafe, buildAllowedTestUrl, SystemTestEnvironment } from './systems-test-url-policy.util.js';

export type SystemsTestHttpRequest = {
  baseUrl: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  payload: unknown;
  timeoutMs: number;
  environment: SystemTestEnvironment;
};

export type SystemsTestHttpResponse = {
  statusCode: number | null;
  responseBody: unknown;
  errorMessage: string | null;
};

/** Tope del cuerpo que se lee de un objetivo: lo que pase de aquí no se carga en memoria de la API. */
export const SYSTEM_TEST_MAX_RESPONSE_BYTES = 1024 * 1024;

class ResponseTooLargeError extends Error {
  constructor() {
    super('SYSTEM_TEST_RESPONSE_TOO_LARGE');
  }
}

@Injectable()
export class SystemsTestHttpClientService {
  async execute(request: SystemsTestHttpRequest): Promise<SystemsTestHttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const url = buildAllowedTestUrl(request.baseUrl, request.path, request.environment);
      await assertResolvedTargetSafe(url, request.environment);
      const response = await fetch(url, {
        method: request.method,
        headers: { 'content-type': 'application/json', ...request.headers },
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : JSON.stringify(request.payload ?? {}),
        signal: controller.signal,
        redirect: 'manual',
      });
      if (response.status >= 300 && response.status < 400) {
        return { statusCode: response.status, responseBody: {}, errorMessage: 'SYSTEM_TEST_REDIRECT_BLOCKED' };
      }
      const text = await this.readCapped(response);
      return { statusCode: response.status, responseBody: this.parseBody(text), errorMessage: null };
    } catch (error) {
      return {
        statusCode: null,
        responseBody: {},
        errorMessage: error instanceof Error ? error.message : 'unknown_error',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  buildUrl(baseUrl: string, path: string, environment: SystemTestEnvironment = 'LOCAL'): string {
    try {
      return buildAllowedTestUrl(baseUrl, path, environment).toString();
    } catch {
      throw new BadRequestException('SYSTEM_TEST_INVALID_URL');
    }
  }

  /** Lee el cuerpo en streaming y corta al pasar el tope, en vez de `response.text()` sin límite. */
  private async readCapped(response: Response): Promise<string> {
    if (Number(response.headers?.get('content-length') ?? 0) > SYSTEM_TEST_MAX_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw new ResponseTooLargeError();
    }
    if (!response.body) return response.text();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > SYSTEM_TEST_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ResponseTooLargeError();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  }

  private parseBody(text: string): unknown {
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text.slice(0, 1000) };
    }
  }
}
