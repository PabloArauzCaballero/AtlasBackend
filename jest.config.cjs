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

  // Fase 1.1 del plan 10/10: la suite completa tarda ~170 s y estaba siendo matada por un corte de
  // 60 s del proceso, lo que ocultaba si realmente pasa (sí pasa: 108 suites / 985 tests verdes).
  // No se limita el proceso: se fija un timeout POR TEST razonable (para que un test colgado falle
  // rápido en vez de colgar el job) y `maxWorkers` para que el tiempo sea estable entre local y CI.
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
    // repos, servicios (notifications/data-quality/external-data facades), guards y los adapters de
    // notificación y external-data). Fase 1.2. Medido con `test:coverage` capado: total repo
    // 80.65/62.52/70.4/81.36 (1749 tests); el "resto" queda ~1 pt por debajo. Umbral con ~2-3 pt de
    // colchón para que el gate aguante aunque CI corra sin los specs untracked ajenos.
    //
    // Bump 79/60/70/79 -> 81/62/74/81 (2026-07-19, 2º del ciclo): 2º lote de cobertura (data-quality.repo,
    // notifications.repo [159 stmts, no era delegador], sessions-device/telemetry, health-monitor,
    // mail-sender.client, systems-test-http-client, mongo-logs-query) subió el "resto" a 84.31/64.95/77.83/
    // 85.13 (repo total 84.61 stmts / 85.41 lines — cruzando el objetivo de 85% en líneas; 238 suites / 1865
    // tests, exit 0, sin flake con maxWorkers=1). Colchón ~3-4 pt para absorber que CI corre sin los 3 specs
    // untracked ajenos (http-exception.filter, domain-schemas, admin-read.service).
    // Historial previo: 77/58/66/77 -> 79/60/70/79 (1er lote: external-data controller+repo, catalog-management.
    // repo, runtime-jobs, systems-catalog-query, adapters de notificación).
    global: { statements: 81, branches: 62, functions: 74, lines: 81 },
    // Dominios críticos con umbral propio (medidos: ver docs/testing/coverage-ratchet.md).
    // Re-baseline Fase 1.2 (medido in-band, 1770 tests): estos 4 paths no dependen de specs untracked
    // ni de código sin commitear (working tree limpio bajo ellos), así que su nivel es reproducible en
    // CI y se ratchetea con ~1.5-2.5 pt de colchón. El `global` NO se sube: su medición está inflada
    // por specs untracked ajenas del "resto", así que quedaría por encima de lo que CI vería.
    // auth: 86.51/67.42/69.49/86.57 (subió de 74.1/74.6 tras cubrir el service layer de auth extraído).
    './src/modules/auth/': { statements: 84, branches: 65, functions: 68, lines: 84 },
    // risk: 91.38/81.40/70.45/91.61 tras el spec directo de RiskRepository y ramas del servicio.
    './src/modules/risk/': { statements: 90, branches: 79, functions: 69, lines: 90 },
    // fraud: 97.26/80.00/100/96.97 tras el spec directo de FraudRepository — 100% de funciones. El
    // branch (80.0) se mantiene en 79 (colchón ~1 pt) porque no subió con el resto.
    './src/modules/fraud/': { statements: 95, branches: 79, functions: 98, lines: 95 },
    // crypto: 91.33/77.55/94.29/92.77 tras los tests de KMS (Fase 3.3) y el PIN de 2FA (Fase 4.2).
    './src/common/utils/crypto/': { statements: 90, branches: 75, functions: 92, lines: 91 },
  },
  clearMocks: true,
};

module.exports = config;
