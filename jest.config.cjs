// Jest CJS config: corre los tests TypeScript como CommonJS.
// Importante: NO usar --experimental-vm-modules ni preset ESM aquí.
// El proyecto compila la app con tsconfig.json (NodeNext), pero los tests se
// transforman con tsconfig.spec.json a CommonJS para que:
// 1) los imports estáticos no generen "exports is not defined";
// 2) los dynamic import(...) se bajen a require(...) y no pidan VM modules.
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

  // Fase 1.1 del plan 10/10: la suite completa tarda ~170 s y estaba siendo matada por un corte de
  // 60 s del proceso, lo que ocultaba si realmente pasa (sí pasa: 108 suites / 985 tests verdes).
  // No se limita el proceso: se fija un timeout POR TEST razonable (para que un test colgado falle
  // rápido en vez de colgar el job) y `maxWorkers` para que el tiempo sea estable entre local y CI.
  testTimeout: 15000,
  maxWorkers: '50%',

  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.module.ts',
    '!src/main.ts',
    '!src/database/migrations/**',
    '!src/database/seeders/**',
  ],
  // `json` (coverage-final.json) se mantiene porque es el formato estándar de istanbul que consumen
  // herramientas externas; `json-summary` (coverage-summary.json) es el que permite recalcular los
  // umbrales por grupo al subir el trinquete (ver docs/testing/coverage-ratchet.md).
  coverageReporters: ['text-summary', 'text', 'lcov', 'json', 'json-summary', 'clover'],

  // Fase 1.2 del plan 10/10 — GATE DE COBERTURA POR TRINQUETE.
  //
  // Los umbrales están fijados en el nivel REAL medido hoy (no en un número aspiracional), con ~1
  // punto de margen para no romper por fluctuaciones. Su función es IMPEDIR REGRESIONES: un PR que
  // baje la cobertura falla. Cada sprint se suben estos números; el objetivo del plan es ≥85% global
  // y ≥90% en auth/risk/fraud/crypto.
  //
  // OJO (comportamiento de Jest): cuando se declaran umbrales por path, los archivos que hacen match
  // se RESTAN del cómputo `global`. Por eso `global` está calibrado contra el "resto" (61.91/43.97/
  // 38.20/62.22 medido), no contra el total de 62.18. Medido con `yarn test:coverage`.
  coverageThreshold: {
    // Trinquete subido tras cubrir el rate limit distribuido y el interceptor de idempotencia
    // (Fase 1.3): el "resto" pasó de 61.91/43.97/38.20/62.22 a 62.38/44.36/38.88/62.66.
    global: { statements: 62, branches: 44, functions: 38, lines: 62 },
    // Dominios críticos con umbral propio (medidos: ver docs/testing/coverage-ratchet.md).
    './src/modules/auth/': { statements: 54, branches: 41, functions: 36, lines: 54 },
    './src/modules/risk/': { statements: 74, branches: 78, functions: 43, lines: 72 },
    './src/modules/fraud/': { statements: 65, branches: 79, functions: 25, lines: 62 },
    './src/common/utils/crypto/': { statements: 83, branches: 71, functions: 75, lines: 85 },
  },
  clearMocks: true,
};

module.exports = config;
