import { BadRequestException, Injectable } from '@nestjs/common';
import { readJsonPath } from './systems-json-path.util.js';

export type SystemsTestTemplateContext = {
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  last: unknown;
};

const TEMPLATE_PATTERN = /\{\{\s*([^{}]+?)\s*}}/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toJsonPath(token: string): string {
  return token.startsWith('$.') || token === '$' ? token : `$.${token}`;
}

function stringifyTemplateValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

@Injectable()
export class SystemsTestTemplateService {
  resolveValue(value: unknown, templateContext: SystemsTestTemplateContext): unknown {
    if (typeof value === 'string') return this.resolveString(value, templateContext);
    if (Array.isArray(value)) return value.map((item) => this.resolveValue(item, templateContext));
    if (!isRecord(value)) return value;

    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = this.resolveValue(nested, templateContext);
    }
    return output;
  }

  resolveString(value: string, templateContext: SystemsTestTemplateContext): unknown {
    const matches = Array.from(value.matchAll(TEMPLATE_PATTERN));
    if (matches.length === 0) return value;

    if (matches.length === 1 && matches[0][0] === value) {
      return this.resolveToken(matches[0][1], templateContext);
    }

    return value.replace(TEMPLATE_PATTERN, (_match, token: string) => stringifyTemplateValue(this.resolveToken(token, templateContext)));
  }

  private resolveToken(rawToken: string, templateContext: SystemsTestTemplateContext): unknown {
    const token = rawToken.trim();
    const [scope, ...pathParts] = token.split('.');
    const path = pathParts.join('.');

    if (scope === 'config') return this.readRequired(templateContext.config, path, token);
    if (scope === 'context') return this.readRequired(templateContext.context, path, token);
    if (scope === 'last') return this.readRequired(templateContext.last, path, token);

    throw new BadRequestException(`SYSTEM_TEST_TEMPLATE_SCOPE_UNSUPPORTED:${scope}`);
  }

  private readRequired(source: unknown, path: string, token: string): unknown {
    const result = readJsonPath(source, path ? toJsonPath(path) : '$');
    if (!result.found) throw new BadRequestException(`SYSTEM_TEST_TEMPLATE_VALUE_NOT_FOUND:${token}`);
    return result.value;
  }
}
