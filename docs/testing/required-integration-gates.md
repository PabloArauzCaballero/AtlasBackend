# Gates de arquitectura y datos obligatorios (AT-050)

Prueba en negativo: `test/integration/testing/required-database-gate.spec.ts`. Política: `scripts/gate-skip-policy.ts`
(ATLAS-CI-002) y `test/integration/support/database.ts`.

## Regla

Un gate que no pudo comprobar nada **no aprueba**. Sólo hay dos modos:

| Modo | Cómo se pide | Base inalcanzable | Cero pruebas descubiertas |
|---|---|---|---|
| Requerido (CI y por defecto) | nada | código de salida ≠ 0 con la causa | código 1 (`No tests found`; `passWithNoTests: false` explícito en `jest.config.cjs`) |
| Salto explícito (sólo local) | `ATLAS_GATES_ALLOW_SKIP=true` o `--allow-skip` | `[skip] …` visible en stderr; **no** se escribe evidencia PASS | igual: sigue siendo fallo |

CI **no** pide el salto: la prueba lee `package.json` y `.github/workflows/ci.yml` (sin comentarios) y falla si aparece
`--passWithNoTests`, `--allow-skip` o `ATLAS_GATES_ALLOW_SKIP`.

## Grupos registrados (scripts)

| Script | Corredor | Qué exige |
|---|---|---|
| `yarn test:architecture` | `jest.config.cjs` sobre `test/architecture` | nada externo; fronteras, fugas de ORM en puertos, mapa de contextos, propiedad de modelos |
| `yarn test:contracts` | `jest.config.cjs` sobre `test/contracts` | nada externo; puertos con doble, seguridad entre límites, contratos de lectura |
| `yarn test:integration` | `jest.integration.config.cjs`, in-band | PostgreSQL con `ATLAS_TEST_DATABASE_ISOLATED=true`; roles por contexto (`ATLAS_TEST_CTX_PASSWORD`) |

Lo que sustituye persistencia por dobles vive en `test/unit` o `test/contracts`, nunca en `test/integration`
(`test/architecture/public-api-leaks.spec.ts` y el corredor lo separan por carpeta).
