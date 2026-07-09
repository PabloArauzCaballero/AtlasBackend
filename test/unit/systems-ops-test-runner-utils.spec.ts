import { readJsonPath } from '../../src/modules/systems-ops/systems-json-path.util.js';
import { SystemsTestAssertionService } from '../../src/modules/systems-ops/systems-test-assertion.service.js';
import { SystemsTestTemplateService } from '../../src/modules/systems-ops/systems-test-template.service.js';

describe('systems ops test runner utilities', () => {
  it('reads supported JSONPath values safely', () => {
    const source = { body: { items: [{ id: 42 }], status: 'ok' } };
    expect(readJsonPath(source, '$.body.items[0].id')).toEqual({ found: true, value: 42 });
    expect(readJsonPath(source, '$.body.missing')).toEqual({ found: false, value: undefined });
  });

  it('resolves templates from config, context and last response', () => {
    const service = new SystemsTestTemplateService();
    const context = {
      config: { queue: 'all' },
      context: { customerId: 7 },
      last: { token: 'abc' },
    };
    expect(service.resolveString('/work?queue={{config.queue}}&customer={{context.customerId}}', context)).toBe(
      '/work?queue=all&customer=7',
    );
    expect(service.resolveString('{{last.token}}', context)).toBe('abc');
  });

  it('evaluates status, duration and JSON body assertions', () => {
    const service = new SystemsTestAssertionService();
    const result = service.evaluate({
      statusCode: 200,
      durationMs: 120,
      responseBody: { status: 'ok', count: 2 },
      assertions: {
        expectedStatusCodes: [200],
        maxDurationMs: 500,
        jsonPathExists: ['$.status'],
        jsonPathEquals: { '$.status': 'ok' },
        jsonPathType: { '$.count': 'number' },
      },
    });
    expect(result.passed).toBe(true);
    expect(result.results.every((assertion) => assertion.passed)).toBe(true);
  });
});
