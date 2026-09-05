## graphify

This project has a graphify knowledge graph at .graphify/.

Rules:
- For codebase or architecture questions, when `.graphify/graph.json` exists, first run `graphify query "<question>"` (or `graphify path "<A>" "<B>"` / `graphify explain "<concept>"`); these return a scoped subgraph, usually much smaller than `GRAPH_REPORT.md` or raw grep output
- If .graphify/wiki/index.md exists, navigate it instead of reading raw files
- If .graphify/graph.json is missing but graphify-out/graph.json exists, run `graphify migrate-state --dry-run` first; if tracked legacy artifacts are reported, ask before using the recommended `git mv -f graphify-out .graphify` and commit message
- If .graphify/needs_update exists or .graphify/branch.json has stale=true, warn before relying on semantic results and run /graphify . --update when appropriate
- Before proposing or committing .graphify artifacts, run `graphify portable-check .graphify`; commit-safe graph artifacts must use repo-relative paths, and never commit .graphify/branch.json, .graphify/worktree.json, .graphify/needs_update, or .graphify/cache/. If a repo already tracks any of them, first add them to .gitignore, then propose `git rm --cached .graphify/branch.json .graphify/worktree.json .graphify/needs_update` and `git rm -r --cached .graphify/cache`; never mutate git state without asking
- Before deep graph traversal, prefer `graphify summary --graph .graphify/graph.json` for compact first-hop orientation
- For review impact on changed files, use `graphify review-delta --graph .graphify/graph.json` instead of generic traversal
- Read `.graphify/GRAPH_REPORT.md` only for broad architecture review or when `query` / `path` / `explain` do not surface enough context
- After modifying code files in this session, run `npx graphify hook-rebuild` to keep the graph current

## graphify — reglas del proyecto (Atlas)

Refuerzo obligatorio de la sección `## graphify` de arriba (esta sección es propia del proyecto y no la sobrescribe una reinstalación de graphify):

- **Comprender antes de tocar:** para cualquier pregunta sobre la estructura o el flujo del código, primero consulta el grafo con `graphify query "<pregunta>"`, `graphify explain "<concepto>"` o `graphify path "<A>" "<B>"`. Solo recurre a `grep`/lectura directa de fuentes después de que graphify te haya orientado, o para modificar/depurar líneas concretas.
- **Mantener el grafo actualizado SIEMPRE:** después de *cualquier* cambio en el código (crear, editar, mover o borrar archivos en `src/`, `scripts/`, `test/`, `tools/`, etc.), ejecuta `graphify update .` antes de dar por terminada la tarea. Es AST-only, no consume API. Si un refactor borró código y el grafo queda con menos nodos, usa `graphify update . --force`.
- **Artefacto local:** `.graphify/` es un artefacto generado y está en `.gitignore`. No se commitea; cada quien lo regenera con `graphify update .`. Las instrucciones degradan con gracia: si `.graphify/graph.json` no existe, regénéralo antes de consultarlo.
- **Instalación:** el CLI vive en `~/.npm-global/bin/graphify` (`npm install -g --prefix "$HOME/.npm-global" @sentropic/graphify`), ya presente en el `PATH` de `~/.zshrc`. Los hooks `PreToolUse` de `.claude/settings.json` son portables (POSIX, sin rutas absolutas) y quedan inertes mientras `.graphify/graph.json` no exista.

## Skills y reglas del proyecto

- **Precedencia de contexto:** auditoría vigente en `docs/audit/` > código y pruebas existentes > docs de `docs/`. Ante contradicción crítica, detente y explícala antes de modificar.
- **Reglas modulares:** `.claude/rules/` (TypeScript backend, base de datos/migraciones, seguridad, testing). Cárgalas según la ruta que toques.
- **Skills:** `.claude/skills/` — procedimientos por área (`backend-production`, `backend-hardening`, `security-audit`, `observability-audit`, `performance-audit`, `clean-code-review`, `library-selection`, `production-verification`). Invócalas por nombre para auditorías o implementación compleja.
- **Comandos verificados** (`package.json`): `yarn type-check` · `yarn type-check:tests` · `yarn lint` · `yarn format:check` · `yarn test` / `test:unit` · `yarn build` · `yarn smoke:*` · gates `yarn check:*`.
- **Evidencia:** no declares una fase terminada sin ejecutar los gates aplicables y conservar su resultado. No inventes comandos, librerías ni endpoints. No expongas secretos ni ejecutes operaciones destructivas de DB sin aprobación.
- **Catálogo de plugins y su selección:** `docs/claude/plugin-selection-matrix.md` (ninguna instalación con MCP/hooks se ejecuta sin aprobación humana).
