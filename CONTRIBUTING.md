# Contribuir a AtlasBackend

Gracias por contribuir. Este proyecto sostiene su calidad con **gates automáticos**:
ningún objetivo cuenta si no está protegido por CI. Un PR se mergea cuando **todos** los
gates están verdes. Esta guía te lleva del clon al PR pasando cada gate en local.

## Requisitos

- **Node** según [`.nvmrc`](.nvmrc) (`nvm use`). CI usa exactamente esa versión.
- **Yarn 1** (el repo usa `yarn.lock`, no `package-lock.json`).
- **PostgreSQL 16** y **Redis 7** para las pruebas de integración/smoke (en CI corren
  como *services*; en local puedes usar Docker).

```bash
nvm use
yarn install --frozen-lockfile
cp .env.example .env   # ajusta las variables locales
```

## Flujo de trabajo

1. Crea una rama desde `main` (no trabajes directo en `main`).
2. Haz cambios pequeños y enfocados. Si divides un archivo grande, hazlo **módulo a
   módulo con smoke/e2e verdes**, nunca en un big-bang (lo exige la auditoría del repo).
3. Corre los gates en local (abajo) **antes** de abrir el PR.
4. Abre el PR contra `main`. Describe el **qué** y el **por qué**; enlaza el issue o ADR.

## Gates que debes pasar (mismos que corre CI)

Corre esto en orden; es lo que valida [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

```bash
yarn lint                 # ESLint (incluye límites de complejidad y tamaño de función)
yarn format:check         # Prettier
yarn check:no-env-file    # ningún .env real commiteado
yarn check:seed-profiles  # seeders separados por perfil; production/ sin datos ficticios
yarn check:overfetching   # sin SELECT * en la capa read_api
yarn check:file-size      # gate de tamaño: ningún archivo runtime NUEVO grande sin excepción
yarn type-check           # tsc --noEmit
yarn test:unit:randomized # unit tests en orden aleatorio (una dependencia de orden falla el PR)
yarn build                # compila
```

Suite completa + cobertura (el job `coverage` de CI):

```bash
yarn test:coverage        # falla si la cobertura baja de los umbrales por trinquete
```

Integración contra Postgres/Redis reales (el job `db-and-cache-integration`):

```bash
yarn db:migration:up
yarn db:seed:demo
yarn smoke:core   # y los demás smoke:* relevantes a tu cambio
```

Seguridad (jobs `codeql`, `secret-scan`, `sbom`, `dependency-audit`): CodeQL, gitleaks,
SBOM y `yarn audit --level high` corren en CI; localmente al menos:

```bash
yarn audit --level high
```

## Reglas de los gates

- **Cobertura (trinquete):** no puedes bajar la cobertura. Los umbrales están en
  [`jest.config.cjs`](jest.config.cjs) y **suben** con el tiempo (objetivo del plan:
  ≥85% global, ≥90% en auth/risk/fraud/crypto). Ver
  [`docs/testing/coverage-ratchet.md`](docs/testing/coverage-ratchet.md).
- **Tamaño/complejidad:** los archivos runtime nuevos grandes se rechazan. Las
  migraciones/seeders/fixtures declarativos están exentos. Una excepción legítima se
  **documenta**, no se silencia.
- **Secretos:** el escaneo cubre el working tree. Nunca commitees `.env`, claves ni
  tokens. Si filtras uno, sigue el
  [runbook de incidentes](docs/runbooks/incident-response.md).
- **CVEs:** un `high`/`critical` bloquea el merge. Un falso positivo se documenta en
  `docs/pending/pending-items.md` con el ID del advisory antes de silenciarlo.

## Migraciones y seeders

- Crea migraciones con `yarn db:migration:create` y seeders con `yarn db:seed:create`.
- Mantén las migraciones **pequeñas** y acotadas por dominio (el gate `migration-check`
  las limita). Los seeders de `production/` deben ser **idempotentes** y **sin datos
  ficticios**.

## Decisiones de arquitectura

Si tu cambio toma o altera una decisión estructural (un almacén, un patrón, un límite de
módulo), escribe o actualiza un **ADR** en [`docs/adr/`](docs/adr/) usando la
[plantilla](docs/adr/_template.md). El código sin la decisión documentada es
conocimiento tribal; el ADR lo convierte en activo del proyecto.

## Estilo

- TypeScript idiomático, coherente con el código circundante (naming, densidad de
  comentarios, patrones de módulo de NestJS).
- Deja que ESLint + Prettier decidan el formato; no pelees con ellos.
- Escribe el comentario que explica el **porqué**, no el **qué**.

## Seguridad

Reporta vulnerabilidades de forma privada según [`SECURITY.md`](SECURITY.md). No abras
issues públicos para fallos de seguridad.
