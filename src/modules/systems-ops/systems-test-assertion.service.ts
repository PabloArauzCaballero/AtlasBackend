import { Injectable } from '@nestjs/common';
import { readJsonPath } from './systems-json-path.util.js';

export type SystemsAssertionEvaluationInput = {
  statusCode: number | null;
  durationMs: number;
  responseBody: unknown;
  assertions: Record<string, unknown>;
};

export type SystemsAssertionResult = {
  name: string;
  passed: boolean;
  expected?: unknown;
  actual?: unknown;
  message?: string;
};

export type SystemsAssertionEvaluation = {
  passed: boolean;
  results: SystemsAssertionResult[];
};

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function sameValue(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function typeName(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

@Injectable()
export class SystemsTestAssertionService {
  evaluate(input: SystemsAssertionEvaluationInput): SystemsAssertionEvaluation {
    const results: SystemsAssertionResult[] = [];
    results.push(this.evaluateStatusCode(input.statusCode, input.assertions));
    results.push(...this.evaluateMaxDuration(input.durationMs, input.assertions));
    results.push(...this.evaluateJsonPathExists(input.responseBody, input.assertions));
    results.push(...this.evaluateJsonPathEquals(input.responseBody, input.assertions));
    results.push(...this.evaluateJsonPathType(input.responseBody, input.assertions));
    return { passed: results.every((result) => result.passed), results };
  }

  private evaluateStatusCode(statusCode: number | null, assertions: Record<string, unknown>): SystemsAssertionResult {
    const expected =
      asNumberArray(assertions['expectedStatusCodes']).length > 0 ? asNumberArray(assertions['expectedStatusCodes']) : [200, 201];
    return {
      name: 'expectedStatusCodes',
      passed: statusCode !== null && expected.includes(statusCode),
      expected,
      actual: statusCode,
    };
  }

  private evaluateMaxDuration(durationMs: number, assertions: Record<string, unknown>): SystemsAssertionResult[] {
    const expected = assertions['maxDurationMs'];
    if (typeof expected !== 'number') return [];
    return [{ name: 'maxDurationMs', passed: durationMs <= expected, expected, actual: durationMs }];
  }

  private evaluateJsonPathExists(responseBody: unknown, assertions: Record<string, unknown>): SystemsAssertionResult[] {
    const paths = Array.isArray(assertions['jsonPathExists']) ? assertions['jsonPathExists'] : [];
    return paths
      .filter((path): path is string => typeof path === 'string')
      .map((path) => {
        const result = readJsonPath(responseBody, path);
        return { name: `jsonPathExists:${path}`, passed: result.found, expected: true, actual: result.found };
      });
  }

  private evaluateJsonPathEquals(responseBody: unknown, assertions: Record<string, unknown>): SystemsAssertionResult[] {
    return Object.entries(asRecord(assertions['jsonPathEquals'])).map(([path, expected]) => {
      const result = readJsonPath(responseBody, path);
      return {
        name: `jsonPathEquals:${path}`,
        passed: result.found && sameValue(result.value, expected),
        expected,
        actual: result.value,
        message: result.found ? undefined : 'JSONPath not found',
      };
    });
  }

  private evaluateJsonPathType(responseBody: unknown, assertions: Record<string, unknown>): SystemsAssertionResult[] {
    return Object.entries(asRecord(assertions['jsonPathType'])).map(([path, expected]) => {
      const result = readJsonPath(responseBody, path);
      const actualType = typeName(result.value);
      return {
        name: `jsonPathType:${path}`,
        passed: result.found && actualType === expected,
        expected,
        actual: result.found ? actualType : 'missing',
      };
    });
  }
}
