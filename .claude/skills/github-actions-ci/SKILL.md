---
name: github-actions-ci
description: Implementación de CI en GitHub Actions — anatomía de workflows, triggers y filtros, matrix, concurrency para cancelar corridas viejas, caché de dependencias (yarn, pip, pub), reusable workflows y composite actions, permissions mínimos del GITHUB_TOKEN, pin de actions por SHA, OIDC, secrets/vars/environments con aprobación, artefactos de Playwright, servicios Postgres y depuración de corridas fallidas. Usar al crear o modificar un workflow, al endurecer uno existente, o cuando una corrida falla y hay que diagnosticarla.
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# CI con GitHub Actions

`ci-cd-pipeline` define **qué** etapas y gates tiene el pipeline (agnóstico de plataforma).
Esta skill es **cómo** se escribe eso en GitHub Actions sin abrir agujeros de seguridad.
Toda la sintaxis de abajo está verificada contra docs.github.com; las versiones de actions
cambian, así que los ejemplos usan marcadores `<sha>` que tenés que resolver vos.

## 1. Anatomía mínima correcta

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
  merge_group:            # obligatorio si la rama usa merge queue

permissions:
  contents: read          # default mínimo para TODO el workflow

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@<sha-completo>   # vX.Y.Z
      - run: yarn install --immutable
      - run: yarn typecheck && yarn test
```

Reglas: todo job lleva `timeout-minutes`; todo workflow declara `permissions`; toda action
de terceros va pinneada (§5).

## 2. Triggers y filtros

| Trigger | Uso | Cuidado |
|---|---|---|
| `pull_request` | CI de PRs | Desde forks: sin secretos y `GITHUB_TOKEN` de solo lectura |
| `push` + `branches` | Post-merge, deploy | Filtrá ramas; no corras todo en cada push a cada rama |
| `merge_group` | Merge queue | Único tipo soportado: `checks_requested` |
| `workflow_dispatch` | Manual con `inputs` (`string`, `boolean`, `choice`…) | Disparable con `gh workflow run` |
| `workflow_call` | Reusable workflow | §4 |
| `schedule` | `cron:` | Corre sobre la rama por defecto |
| `repository_dispatch` | Disparo entre repos | Solo si el workflow existe en la rama por defecto |
| `workflow_run` | Encadenar tras otro workflow | Tiene secretos y token de escritura: tratá los artefactos del workflow previo como no confiables |
| `pull_request_target` | **Evitar** | Corre privilegiado; nunca hagas checkout de código del PR ahí |

`paths:` / `paths-ignore:` para no correr la suite entera por un cambio de docs. Ojo: un check
**requerido** que no corre por filtro de paths deja el PR esperando; resolvelo con un job
liviano que siempre reporte, no quitando el requisito.

## 3. Matrix

```yaml
strategy:
  fail-fast: false        # hermano de matrix, no hijo
  max-parallel: 2
  matrix:
    node: [20, 22]
    include:
      - node: 22
        coverage: true
    exclude:
      - node: 20
        os: windows-latest
```

- `fail-fast: false` cuando querés ver **todas** las fallas (diagnóstico); `true` para ahorrar minutos.
- Sharding de Playwright: una dimensión `shard` y pasar `--shard=${{ matrix.shard }}/N`.
  Los E2E que comparten estado van seriales: un solo shard, workers = 1 (`e2e-playwright`).

## 4. Reutilización

**Reusable workflow** (jobs completos, compartidos entre repos):

```yaml
# quien llama
jobs:
  ci:
    uses: mi-org/ci-shared/.github/workflows/node-ci.yml@<sha-o-tag>
    with:
      node-version: '22'
    secrets: inherit       # solo dentro de la misma organización/enterprise
```

- `{ref}` puede ser SHA, tag o rama; si tag y rama se llaman igual, gana el tag. Preferí SHA o tag.
- Hasta 10 niveles de anidación (el llamador + 9).
- Los permisos a lo largo de la cadena solo se **mantienen o reducen**, nunca se elevan.
- Salidas: `on.workflow_call.outputs` → el llamador las lee con `needs.<job>.outputs.<nombre>`.

**Composite action** (pasos reutilizables dentro de un job): usala para "setup del stack"
(instalar runtime + caché + install). Vive en `.github/actions/<nombre>/action.yml`.

| Necesito… | Usá |
|---|---|
| Compartir una secuencia de steps | Composite action |
| Compartir jobs enteros, con runners/servicios/secrets | Reusable workflow |
| Lo mismo en los 5 repos hermanos | Reusable workflow en repo compartido (`github-multirepo-coordination`) |

## 5. Seguridad del workflow (no negociable)

1. **`permissions` mínimos.** Default `contents: read` arriba; elevá **por job** solo lo que ese
   job usa (`pull-requests: write` para comentar, `id-token: write` para OIDC,
   `security-events: write` para subir resultados de code scanning). `permissions: {}` deshabilita todo.
2. **Pin por SHA completo.** Es la única forma de usar una action como release inmutable.
   Verificá que el SHA sea del repo oficial y no de un fork. Dejá el tag en un comentario.
   Dependabot actualiza actions por versión semántica; con SHA, revisá el soporte actual en la
   doc de Dependabot y no asumas que el bump llega solo.
3. **Inyección de scripts.** Nunca interpoles contexto no confiable dentro de `run:`.

   ❌ `run: echo "${{ github.event.pull_request.title }}"`
   ✅
   ```yaml
   env:
     TITLE: ${{ github.event.pull_request.title }}
   run: echo "$TITLE"
   ```
   No confiables: títulos, cuerpos, nombres de rama, mensajes de commit, autores.
4. **OIDC en vez de credenciales largas.** Para nubes que lo soportan: `id-token: write` en el
   job y una relación de confianza condicionada por claims (`sub` con forma
   `repo:org/repo:environment:prod`, más `repository`, `ref`, `environment`). El token dura un job.
5. **Secrets.** Uno por valor (no JSON/YAML estructurado: no se enmascara bien). Enmascará valores
   generados con `::add-mask::`. Secreto expuesto en un log = rotarlo y borrar el log.
6. **Environments** para deploy: secretos por entorno + revisores requeridos + restricción de
   ramas. `environment: { name: production }` en el job.
7. **`.github/workflows/` en CODEOWNERS**: cambiar el CI requiere aprobación de su dueño.
8. **Caché ≠ lugar seguro.** Quien pueda abrir un PR puede leer cachés de la rama base.

`vars` (configuración no sensible) vs `secrets` (sensible): no pongas URLs de entornos en
secrets ni tokens en vars.

## 6. Caché de dependencias

| Stack | Mecanismo |
|---|---|
| Node / Yarn | `actions/setup-node` con `cache: yarn` (soporta npm, Yarn y pnpm) |
| Python / pip | `actions/setup-python` con `cache: pip` (también pipenv, Poetry) |
| Flutter / pub | `actions/cache` sobre el pub cache, key por `hashFiles('**/pubspec.lock')` |
| Otro | `actions/cache`: `path`, `key`, `restore-keys`; salida `cache-hit` |

- Key = SO + hash del lockfile: `${{ runner.os }}-yarn-${{ hashFiles('**/yarn.lock') }}`.
- Con Yarn moderno vía Corepack, habilitá Corepack **antes** del paso que resuelve la caché
  (verificar el orden en el README de `setup-node`).
- Alcance: una corrida restaura cachés de su rama, de la default y, en PRs, de la base.
  No de ramas hermanas. Se expiran a los 7 días sin acceso; hay tope de almacenamiento por repo.
- La caché acelera; la corrección la da `--immutable` / lockfile congelado.

## 7. Servicios: Postgres para integración

```yaml
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_PASSWORD: postgres
    ports: ['5432:5432']
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

Sin health check, los tests arrancan antes que la base. Misma versión mayor que producción.
La contraseña del contenedor efímero no es un secreto; la de cualquier entorno real, sí.
Qué se prueba contra esa base: `integrity-testing`.

## 8. Artefactos (traces de Playwright)

```yaml
- uses: actions/upload-artifact@<sha-completo>
  if: ${{ !cancelled() }}
  with:
    name: playwright-report-${{ matrix.shard }}
    path: playwright-report/
    retention-days: 7
```

- Subí **aunque falle** (`if: ${{ !cancelled() }}`): el trace importa cuando hay rojo.
- Nombre único por entrada de matrix, o los artefactos chocan.
- Los artefactos pueden contener datos de prueba: retención corta y **nunca** datos reales.

## 9. Depurar una corrida fallida

1. `gh run list --branch <rama> --status failure` → ubicá la corrida.
2. `gh run view <id> --log-failed` → solo los pasos que fallaron. Leé el **primer** error.
3. Clasificá: ¿código, test, entorno, dato, externo? (`e2e-failure-triage`).
4. ¿Flaky? `gh run rerun <id> --failed` re-ejecuta solo lo fallado; con `--debug`, logging
   detallado. Un rerun verde **no** cierra el tema: registrá el flaky (`regression-suite-management`).
5. Reproducí local con el mismo comando del workflow antes de tocar el YAML.
6. `gh run watch <id> --exit-status` para esperar el resultado desde un script.

Más comandos: `github-cli-automation`.

## Anti-patrones

- Sin bloque `permissions` (queda el default del repo/organización, que puede ser escritura).
- `uses: alguien/action@main` o `@v1` en actions de terceros.
- `pull_request_target` + checkout del head del PR.
- `continue-on-error: true` para "poner verde".
- Secrets en `env:` a nivel workflow cuando los usa un solo step.
- Un workflow de 600 líneas copiado en 5 repos en vez de uno reusable.
- Reintentar hasta que pase y llamarlo estable.

## Checklist

- [ ] `permissions` mínimos arriba; elevaciones por job, justificadas.
- [ ] Actions de terceros pinneadas por SHA completo con el tag en comentario.
- [ ] `concurrency` con `cancel-in-progress` en CI de PRs (no en deploys a producción).
- [ ] `timeout-minutes` en cada job.
- [ ] Ningún contexto no confiable interpolado en `run:`.
- [ ] Caché con key por lockfile; install inmutable.
- [ ] Servicios con health check; versión alineada con producción.
- [ ] Artefactos subidos también en fallo, con retención corta y sin datos reales.
- [ ] `merge_group` presente si hay merge queue.
- [ ] Deploy con `environment` + revisores; nube vía OIDC.
- [ ] `.github/workflows/` cubierto por CODEOWNERS.
