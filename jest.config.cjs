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
    // El "resto" (scope de `global`, todo menos los paths con umbral propio) subió a
    // 62.90/44.55/39.04/63.22 tras cubrir observabilidad (Fase 3.4). Se mantiene el piso con margen
    // amplio; los bumps van a los dominios con umbral propio donde la mejora fue holgada.
    global: { statements: 62, branches: 44, functions: 38, lines: 62 },
    // Dominios críticos con umbral propio (medidos: ver docs/testing/coverage-ratchet.md).
    // auth: 57.2/45.0/37.5/57.2 tras la extracción de AuthActorResolver/AuthPasswordReset (Fase 2.2).
    './src/modules/auth/': { statements: 56, branches: 43, functions: 37, lines: 56 },
    './src/modules/risk/': { statements: 74, branches: 78, functions: 43, lines: 72 },
    // fraud: 93.2/80.0/100/92.4 tras el spec directo de FraudRepository (Fase 1.2) — de 25% a 100%
    // de funciones cubiertas.
    './src/modules/fraud/': { statements: 90, branches: 79, functions: 95, lines: 90 },
    // crypto: 85.0/71.4/80.0/86.7 tras los tests del proveedor activo de KMS (Fase 3.3).
    './src/common/utils/crypto/': { statements: 84, branches: 71, functions: 78, lines: 86 },
  },
  clearMocks: true,
};

module.exports = config;
