---
name: production-verification
description: Verificación de preparación para producción del backend Atlas ejecutando los gates reales (typecheck, lint, format, tests, build, smokes, gates check:*, migración up→down→up). No declara "listo para producción" si algún gate crítico no pudo ejecutarse.
---

# production-verification

**Propósito.** Confirmar con evidencia ejecutada que un cambio funciona y no rompe los gates.

**Cuándo usarla.** Antes de dar por terminada una fase, abrir un PR o declarar algo listo.
**Cuándo NO.** Como auditoría estática de riesgos (usa `backend-hardening`).

**Fuentes obligatorias.** `package.json` (scripts reales), `.github/workflows/ci.yml`, `jest.config.cjs`.

**Entradas.** El cambio a verificar (diff/branch).

**Condiciones de parada.** Si un gate crítico no puede ejecutarse (falta entorno, DB, etc.), NO declares éxito: repórtalo como no verificado.

**Matriz de gates (comandos reales).**
| Gate | Comando |
|---|---|
| Typecheck (src/scripts) | `yarn type-check` |
| Typecheck (tests) | `yarn type-check:tests` |
| Lint | `yarn lint` |
| Formato | `yarn format:check` |
| Unit | `yarn test:unit` (o `test:unit:randomized`) |
| Suite + cobertura | `yarn test` / `yarn test:coverage` |
| Build | `yarn build` |
| Gates de dominio | `yarn check:file-size`, `check:overfetching`, `check:domain-schemas`, `check:domain-schema-layout`, `check:read-api-views`, `check:seed-profiles` |
| Privilegios DB (CI) | `yarn check:db-privileges --strict` |
| Migración reversible (CI) | `db:migration:up` → `down` → `up` |
| Smokes (API arriba) | `yarn smoke:*`, `smoke:frontend-contract` |
| Seguridad deps | `yarn audit --level high` |

**Comandos prohibidos.** Migraciones/seeds destructivos, smokes contra producción, `git push` sin aprobación.

**Evidencia requerida.** Salida (verde/rojo) de cada gate ejecutado; recuento de suites/tests; gates omitidos justificados.

**Entregables.** Reporte: gate → resultado → evidencia; veredicto (listo / no listo) con los bloqueadores.

**Formato.** Tabla gate→resultado, luego veredicto.

**Checklist final.** ¿Todos los gates aplicables ejecutados? ¿Algún crítico omitido? ¿Veredicto honesto?

**Limitaciones.** Los smokes y la matriz de privilegios necesitan entorno con DB/Redis; sin él se marcan no verificados.

**Trazabilidad.** `CLAUDE_ORGANIZAR_SKILLS_BACKEND.md` §11 + `.github/workflows/ci.yml`.
