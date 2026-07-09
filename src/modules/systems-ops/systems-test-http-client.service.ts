import { BadRequestException, Injectable } from '@nestjs/common';

export type SystemsTestHttpRequest = {
  baseUrl: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  payload: unknown;
  timeoutMs: number;
};

export type SystemsTestHttpResponse = {
  statusCode: number | null;
  responseBody: unknown;
  errorMessage: string | null;
};

@Injectable()
export class SystemsTestHttpClientService {
  async execute(request: SystemsTestHttpRequest): Promise<SystemsTestHttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const url = this.buildUrl(request.baseUrl, request.path);
      const response = await fetch(url, {
        method: request.method,
        headers: { 'content-type': 'application/json', ...request.headers },
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : JSON.stringify(request.payload ?? {}),
        signal: controller.signal,
      });
      const text = await response.text();
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

  buildUrl(baseUrl: string, path: string): string {
    try {
      return new URL(path, baseUrl).toString();
    } catch {
      throw new BadRequestException('SYSTEM_TEST_INVALID_URL');
    }
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
