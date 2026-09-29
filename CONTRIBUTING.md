# Contribuir a AtlasBackend

Gracias por contribuir. Este proyecto sostiene su calidad con **gates automáticos**:
ningún objetivo cuenta si no está protegido por CI. Un PR se mergea cuando **todos** los
gates están verdes. Esta guía te lleva del clon al PR pasando cada gate en local.

## Requisitos

- **Node** según [`.nvmrc`](.nvmrc) (`nvm use`). CI usa exactamente esa versión.
- **Yarn 1** (el repo usa `yarn.lock`, no `package-lock.json`).
- **PostgreSQL 16** y **Redis 7** para las pruebas de integración/smoke (en CI corren
  como _services_; en local puedes usar Docker).

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
yarn check:env-example    # .env.example cubre todo el esquema Zod y no duplica claves
# `check:seed-profiles` ya NO existe: se fue con los seeders del repositorio cuando las semillas
# pasaron a una base aparte. Lo vigente sobre semillas es `yarn db:seed:verify-graph`.
yarn check:overfetching   # sin SELECT * en la capa read_api
yarn check:file-size      # gate de tamaño: ningún archivo runtime NUEVO grande sin excepción
yarn type-check           # tsc --noEmit
yarn type-check:tests     # contratos de tipos de mocks y fixtures (bloqueante)
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

## Documentación

CI (job `docs-drift`, exigido por `release-gate`) falla si la documentación cita algo que el código no
tiene. Córrelo entero en local con `yarn check:docs-drift`:

- **Cifras** (rutas, módulos, migraciones, eventos, trabajos de fondo, pruebas): van entre marcas
  `<!-- fig:clave -->N<!-- /fig -->` y se reescriben con `yarn docs:figures`. No escribas un número
  calculable a mano.
- **Comandos `yarn`** citados en `.md` (spans y bloques de código): tienen que existir en `package.json`.
- **Rutas HTTP** citadas como `` `GET /ruta` `` en `docs/api`, `endpoints`, `governance`, `security` y
  `events`: tienen que existir en el contrato; las de otro servicio, con el servicio delante.
- **Rutas de archivo** citadas como código (`src/…`, `test/…`, `scripts/…`…): tienen que existir; si el
  texto la cita para decir que se retiró, dilo en la misma línea («retirado»).
- **Documentos generados**: `yarn docs:events` (catálogo de eventos y AsyncAPI) y `yarn docs:rbac-matrix`.
  No se editan a mano; el gate compara byte a byte.

Quedan fuera, por ser registros fechados: `docs/audit/`, `evidencia/`, `CHANGELOG.md` y `.claude/`.

## Migraciones y seeders

- Crea migraciones con `yarn db:migration:create`. Mantén las migraciones **pequeñas** y acotadas
  por dominio (el gate `yarn check:migrations` bloquea colisiones contra una base vacía).
- Ya no hay seeders versionados ni `db:seed:create`. El dato de semilla vive en una base aparte y se
  trae con `yarn db:seed:pull` (ver `docs/database/seeds.md`). La siembra demostrativa del repositorio
  es `src/database/seeders/demo/` (`yarn db:seed:demo`): upserts por clave natural, sin identificadores
  de otra base — `yarn check:seed-references` lo exige.

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
- Si agregas, mueves o eliminas archivos/carpetas, corre `yarn docs:project`. El comando actualiza
  inventarios y cabeceras faltantes sin reemplazar los README escritos a mano.

## Seguridad

Reporta vulnerabilidades de forma privada según [`SECURITY.md`](SECURITY.md). No abras
issues públicos para fallos de seguridad.
