# Estrategia de pruebas

**292 suites, 2 519 pruebas.** Cobertura con trinquete calibrado al valor medido, no aspiracional.

---

## Capas

| Capa | Dónde | Qué prueba | Necesita |
|---|---|---|---|
| Unitarias | `test/unit/` | Reglas de negocio y contratos de servicio, con dependencias dobladas | Nada |
| E2E | `test/e2e/` | Flujos completos a través del módulo Nest | Nada externo |
| Contrato | `scripts/smoke/frontend-contract.smoke.ts`, `internal-rbac.smoke.ts` | Que la forma que consume el frontend no cambió | API levantada + credenciales |
| Smoke | `scripts/smoke/*` | Que un despliegue responde de verdad | API levantada |
| Estrés | `scripts/stress/` | Comportamiento bajo carga del fan-out de notificaciones | API levantada |
| Migraciones | Job de CI | `up → down → up` sobre PostgreSQL real | PostgreSQL |
| Contrato de API | `yarn check:openapi`, `yarn docs:openapi:lint` | Que el contrato publicado sigue siendo utilizable | Nada |

---

## Qué se prueba y qué no

**Se prueba comportamiento, no implementación**, cuando es posible. Los specs de repositorio que
asertan sobre `where` son la excepción deliberada: ahí el contrato **es** la query, y una cláusula
perdida es un fallo de aislamiento de tenant.

Se prueba de forma explícita todo lo que falla en silencio:

- Que con `APP_ROLE=api` **no** se programa ningún timer (si fallara, el trabajo de fondo correría
  duplicado en cada réplica).
- Que en modo diferido la API **no** entrega notificaciones (si fallara, se entregarían en el proceso
  equivocado y nadie lo notaría).
- Que la sonda del worker **no** expone rutas de negocio.
- Que readiness responde 503 durante el drenado **sin** consultar Postgres.

Las aserciones negativas son las que más valen aquí: un fallo en cualquiera de ellas no produce
ningún error visible.

---

## Reglas

| Regla | Por qué |
|---|---|
| Un spec por módulo como mínimo | 27 módulos, 27 specs. No bajar de ahí |
| Orden aleatorizado en CI (`test:unit:randomized`) | Una dependencia de orden entre tests debe fallar el PR, no volverse flakiness |
| Teardown limpio | Todo timer, cliente o servidor se cierra. Un «worker failed to exit gracefully» es un bug de teardown |
| `yarn type-check:tests` | Los specs tampoco compilan con errores de tipo |
| El trinquete de cobertura no baja | Ver [coverage-ratchet.md](coverage-ratchet.md) |

---

## Gates de CI

`type-check`, `type-check:tests`, `lint`, `format:check`, `test:unit:randomized`, `test:coverage`,
`build`, `check:file-size`, `check:migrations`, `check:env-example`, `check:openapi`,
`docs:openapi:lint`, `check:domain-schemas`, `check:domain-schema-layout`, `check:overfetching`,
`check:read-api-views`, `check:tenant-header`, `check:seed-profiles`, `check:no-env-file`,
`check:smoke-results-untracked`, build de la imagen, validación de los manifiestos de compose,
`yarn audit --level high`, CodeQL, gitleaks y SBOM.

**No se declara «listo para producción» si un gate crítico no se pudo ejecutar.** Lo que no corrió se
declara, no se omite: ver [Validación final](../reports/final-validation.md).
