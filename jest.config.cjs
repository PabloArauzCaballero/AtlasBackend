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
    // El "resto" (scope de `global`, todo menos los paths con umbral propio) subió fuerte tras cubrir
    // con specs directos TODO el service layer testeable (auth extraídos, systems-ops completo,
    // mail-sender, http-action-log, audit, mongo-logs, etc.) y TODOS los controllers testeables (audit,
    // events, operations, sessions, customer-onboarding, catalog-management, notifications, external-data
    // verticales, systems-ops×N, etc.) + un push de BRANCH coverage sobre los mappers puros y los 8
    // adapters de external-data + extensión de repos (internal-rbac, schema-management, external-data,
    // systems-review + operations/customer-telemetry/systems-catalog: mutaciones, cursor keyset, upserts,
    // y los mappers/adapters puros). Fase 1.2. Medido con `test:coverage` capado: total repo
    // 79.03/61.64/66.86/79.73 (1715 tests); el "resto" queda ~1 pt por debajo. Umbral con ~2-3 pt de
    // colchón para que el gate aguante aunque CI corra sin los specs untracked ajenos.
    global: { statements: 75, branches: 57, functions: 62, lines: 75 },
    // Dominios críticos con umbral propio (medidos: ver docs/testing/coverage-ratchet.md).
    // auth: 74.1/57.7/66.1/74.6 tras el spec directo de auth.repository (Fase 1.2). El repositorio no
    // tenía test (AuthService lo mockea): lockout, one-time codes, rotación/revocación de refresh y
    // el mapeo de actor en la auditoría no se ejercitaban.
    './src/modules/auth/': { statements: 73, branches: 56, functions: 65, lines: 73 },
    // risk: 90.8/78.3/68.2/91.0 tras el spec directo de RiskRepository (Fase 1.2) — el repositorio
    // no tenía test propio (servicio y controller lo mockean), así que sus funciones no se ejercitaban.
    './src/modules/risk/': { statements: 89, branches: 78, functions: 67, lines: 89 },
    // fraud: 93.2/80.0/100/92.4 tras el spec directo de FraudRepository (Fase 1.2) — de 25% a 100%
    // de funciones cubiertas.
    './src/modules/fraud/': { statements: 90, branches: 79, functions: 95, lines: 90 },
    // crypto: 89.0/73.5/88.6/90.4 tras los tests de KMS (Fase 3.3) y el PIN de 2FA (Fase 4.2), que
    // usa one-time-code.util.
    './src/common/utils/crypto/': { statements: 88, branches: 73, functions: 87, lines: 90 },
  },
  clearMocks: true,
};

module.exports = config;
