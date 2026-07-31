// Jest CJS config: corre los tests TypeScript como CommonJS.
// Importante: NO usar --experimental-vm-modules ni preset ESM aquí.
// El proyecto compila la app con tsconfig.json (NodeNext), pero los tests se
// transforman con tsconfig.spec.json a CommonJS para que:
// 1) los imports estáticos no generen "exports is not defined";
// 2) los dynamic import(...) se bajen a require(...) y no pidan VM modules.
// Fase 1.2 (fix del flake del gate): cuando se corre con `--coverage`, forzamos UN solo worker.
// El error intermitente "Coverage data for ./src/modules/auth/ was not found" (exit 1 pese a que
// todos los tests pasan) es el race de Jest al FUSIONAR los coverage maps de varios workers: bajo
// presión de memoria un worker se reinicia/OOM y su parte del mapa se pierde, dejando un grupo de
// umbral (p. ej. auth) sin datos justo cuando se evalúa el threshold. Con un único worker no hay
// fusión entre procesos → el cómputo de cobertura es determinista. El dev loop (`yarn test`, sin
// `--coverage`) mantiene `maxWorkers: '50%'` para seguir siendo rápido; solo el GATE corre in-band.
const isCoverageRun =
  process.argv.some((a) => a === '--coverage' || a === '--collectCoverage' || a.startsWith('--coverage=')) ||
  process.env.npm_lifecycle_event === 'test:coverage';

/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup-jest-env.cjs'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.spec.json',
        diagnostics: {
          warnOnly: true,
        },
      },
    ],
  },
  testMatch: ['**/test/**/*.spec.ts', '**/test/**/*.test.ts'],

  // El timeout es por prueba, no para la suite completa. La validación del 28-jul-2026 ejecutó 263
  // suites / 2.191 tests con cobertura; el proceso completo puede tardar varios minutos según I/O.
  testTimeout: 15000,
  // '50%' para el dev loop; 1 para el gate de cobertura (ver `isCoverageRun` arriba: evita el flake
  // de fusión de coverage maps entre workers).
  maxWorkers: isCoverageRun ? 1 : '50%',

  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.module.ts',
    '!src/main.ts',
    // Glue de arranque con efecto de importación (como main.ts): arranca OpenTelemetry antes que la
    // app. No tiene lógica testeable por sí mismo; `tracing.ts` sí se cubre por unit test.
    '!src/observability/tracing-bootstrap.ts',
    '!src/database/migrations/**',
    '!src/database/seeders/**',
  ],
  // `json` (coverage-final.json) se mantiene porque es el formato estándar de istanbul que consumen
  // herramientas externas; `json-summary` (coverage-summary.json) es el que permite recalcular los
  // umbrales por grupo al subir el trinquete (ver docs/testing/coverage-ratchet.md).
  coverageReporters: ['text-summary', 'text', 'lcov', 'json', 'json-summary', 'clover'],

  // Gate por trinquete medido el 28-jul-2026. Los paths críticos se restan del cómputo `global` de
  // Jest, de modo que `global` representa el resto del backend. Evidencia y cifras completas:
  // docs/testing/coverage-ratchet.md.
  coverageThreshold: {
    // Medido: 85.05 / 67.04 / 77.25 / 85.58.
    global: { statements: 83, branches: 67, functions: 77, lines: 83 },
    // Medido: 96.46 / 72.32 / 93.65 / 96.99.
    './src/modules/auth/': { statements: 94, branches: 72, functions: 92, lines: 95 },
    // Medido: 98.85 / 81.40 / 100 / 100.
    './src/modules/risk/': { statements: 97, branches: 80, functions: 98, lines: 98 },
    // Medido: 97.26 / 80.00 / 100 / 96.97.
    './src/modules/fraud/': { statements: 95, branches: 79, functions: 98, lines: 95 },
    // Medido: 91.01 / 76.47 / 94.29 / 91.86.
    './src/common/utils/crypto/': { statements: 90, branches: 75, functions: 92, lines: 91 },
  },
  clearMocks: true,
};

module.exports = config;
