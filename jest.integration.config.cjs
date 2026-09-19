// Corredor de las pruebas de integración (AT-002): PostgreSQL real, sin dobles de persistencia.
//
// Comparte transformación, `setupFiles` y `moduleNameMapper` con `jest.config.cjs`; sólo cambia lo
// que ese corredor excluye a propósito: `test/integration/`. Corre in-band (`yarn test:integration`
// pasa `--runInBand`) porque las pruebas comparten una base y miden carreras que ellas mismas
// provocan, no las que provocaría otro worker.
//
// Sin cobertura: estas pruebas miden propiedades de la base (rollback, unicidad, leases), no
// líneas; el trinquete de cobertura sigue siendo el de `jest.config.cjs`.
const base = require('./jest.config.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  testMatch: ['**/test/integration/**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  collectCoverage: false,
  coverageThreshold: undefined,
  // Cada prueba abre transacciones reales y algunas esperan a un lease; 15 s se quedaba corto en CI.
  testTimeout: 30000,
  maxWorkers: 1,
};
