---
paths:
  - "test/**/*.ts"
  - "scripts/smoke/**/*.ts"
  - "jest.config.cjs"
  - ".github/workflows/**"
---

# Testing y CI

Fuente: `docs/audit/revision-completa-backend-2026-07-21.md` (sección Testing/CI).

- **Un spec por módulo como mínimo.** Los 25 módulos de `src/modules/` tienen specs; no bajar esa cobertura.
- **Probar comportamiento, no implementación**, cuando sea posible. Los specs de repository que asertan sobre `mock.calls[...].where` documentan el contrato de query; complementarlos con verificación de comportamiento donde el riesgo lo justifique.
- **Cobertura con trinquete** (`jest.config.cjs` `coverageThreshold`): calibrada al valor medido, no aspiracional. No bajar umbrales para “pasar”; subirlos al mejorar. Dominios críticos (auth/risk/fraud/crypto) tienen umbral reforzado.
- **Orden aleatorizado** (`test:unit:randomized`) en CI: una dependencia de orden entre tests debe fallar el PR, no volverse flakiness.
- **Teardown limpio:** todo recurso con timer/handle (SDK, cliente, servidor) se cierra en `afterAll`/`onModuleDestroy`; usar `.unref()` en timers de prueba. Un “worker failed to exit gracefully” es un bug de teardown a corregir.
- **Type-check de tests:** `yarn type-check:tests` (los specs no deben compilar con errores de tipo).
- **Smokes** requieren la API levantada; los de contrato (`frontend-contract`, `internal-rbac`) autentican de verdad y necesitan credenciales inyectadas (no versionar contraseñas en claro; usar `requireSmokeEnv`).
- **No declarar “listo para producción”** si un gate crítico no se pudo ejecutar.

**Gates CI:** type-check(+tests), lint, format:check, unit(randomized), suite+coverage, build, migración up→down→up, seeds, `check:db-privileges --strict`, smokes, `yarn audit`, CodeQL, gitleaks, SBOM.
