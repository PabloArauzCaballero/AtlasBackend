import { describe, expect, it } from '@jest/globals';
import {
  bool,
  checkMockHealth,
  num,
  scenarioFromInput,
  str,
} from '../../../src/modules/external-data/infrastructure/adapters/shared/mock-http.util.js';

/**
 * Helpers compartidos por los adapters de proveedores externos. Se cubren los coercers de tipo, la
 * derivación de escenario y las ramas de checkMockHealth que NO hacen HTTP (disabled / no-mock / mock
 * sin baseUrl).
 */
describe('mock-http.util', () => {
  it('bool/num/str coercen solo el tipo correcto', () => {
    expect(bool(true)).toBe(true);
    expect(bool('x')).toBeUndefined();
    expect(num(5)).toBe(5);
    expect(num(NaN)).toBeUndefined();
    expect(num(Infinity)).toBeUndefined();
    expect(num('5')).toBeUndefined();
    expect(str('a')).toBe('a');
    expect(str(5)).toBeUndefined();
  });

  it('scenarioFromInput prioriza input.scenario, luego input.input.scenario, luego happy_path', () => {
    expect(scenarioFromInput({ scenario: 'x', input: {} } as never)).toBe('x');
    expect(scenarioFromInput({ input: { scenario: 'y' } } as never)).toBe('y');
    expect(scenarioFromInput({ input: {} } as never)).toBe('happy_path');
  });

  it('checkMockHealth: disabled -> DOWN, modo no-mock -> UP, mock sin baseUrl -> DOWN', async () => {
    expect(await checkMockHealth('P', 'disabled')).toMatchObject({ status: 'DOWN', errorCode: 'PROVIDER_DISABLED' });
    expect(await checkMockHealth('P', 'local' as never)).toMatchObject({ status: 'UP' });
    expect(await checkMockHealth('P', 'mock_server', undefined)).toMatchObject({ status: 'DOWN', errorCode: 'MOCK_BASE_URL_MISSING' });
  });
});
