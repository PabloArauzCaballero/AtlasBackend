import { buildEndpointCode, endpointPathMatches, endpointPathSpecificity } from '../../src/modules/systems-ops/endpoint-code.util.js';

describe('systems ops endpoint utilities', () => {
  it('builds stable endpoint codes without query strings', () => {
    expect(buildEndpointCode('get', '/api/v1/customers/:customerId/session-state?debug=true')).toBe(
      'GET_CUSTOMERS_BY_CUSTOMERID_SESSION_STATE',
    );
  });

  it('builds the SAME code for a route in Express syntax and in OpenAPI syntax', () => {
    // SOURCE_SCAN lee `:customerId` de los decoradores; OPENAPI_CONTRACT describe la misma ruta
    // como `{customerId}`. Sin unificarlas, catalogan la misma ruta como dos filas distintas.
    expect(buildEndpointCode('patch', '/api/v1/customer-onboarding/:customerId/profile')).toBe(
      buildEndpointCode('patch', '/api/v1/customer-onboarding/{customerId}/profile'),
    );
  });

  it('matches route templates against concrete HTTP paths', () => {
    expect(endpointPathMatches('/api/v1/customers/:customerId/sessions/:sessionId/end', '/api/v1/customers/12/sessions/99/end')).toBe(true);
    expect(endpointPathMatches('/api/v1/customers/:customerId/sessions/:sessionId/end', '/api/v1/customers/12/sessions')).toBe(false);
  });

  it('ranks static routes above dynamic templates', () => {
    expect(endpointPathSpecificity('/api/v1/systems/stress-matrix')).toBeGreaterThan(endpointPathSpecificity('/api/v1/systems/:profileId'));
  });
});
