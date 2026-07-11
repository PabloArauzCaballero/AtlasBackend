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

  buildUrl(baseUrl: string, path: string, environment: SystemTestEnvironment = 'LOCAL'): string {
    try {
      return buildAllowedTestUrl(baseUrl, path, environment).toString();
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
