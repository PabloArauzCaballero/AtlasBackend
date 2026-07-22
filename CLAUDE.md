## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## graphify — reglas del proyecto (Atlas)

Refuerzo obligatorio de la sección `## graphify` de arriba (esta sección es propia del proyecto y no la sobrescribe una reinstalación de graphify):

- **Comprender antes de tocar:** para cualquier pregunta sobre la estructura o el flujo del código, primero consulta el grafo con `graphify query "<pregunta>"`, `graphify explain "<concepto>"` o `graphify path "<A>" "<B>"`. Solo recurre a `grep`/lectura directa de fuentes después de que graphify te haya orientado, o para modificar/depurar líneas concretas.
- **Mantener el grafo actualizado SIEMPRE:** después de *cualquier* cambio en el código (crear, editar, mover o borrar archivos en `src/`, `scripts/`, `test/`, `tools/`, etc.), ejecuta `graphify update .` antes de dar por terminada la tarea. Es AST-only, no consume API. Si un refactor borró código y el grafo queda con menos nodos, usa `graphify update . --force`.
- **Artefacto local:** `graphify-out/` es un artefacto generado y está en `.gitignore`. No se commitea; cada quien lo regenera con `graphify update .`. Las instrucciones degradan con gracia: si `graphify-out/graph.json` no existe, regénéralo antes de consultarlo.

## Skills y reglas del proyecto

- **Precedencia de contexto:** auditoría vigente en `docs/audit/` > código y pruebas existentes > docs de `docs/`. Ante contradicción crítica, detente y explícala antes de modificar.
- **Reglas modulares:** `.claude/rules/` (TypeScript backend, base de datos/migraciones, seguridad, testing). Cárgalas según la ruta que toques.
- **Skills:** `.claude/skills/` — procedimientos por área (`backend-production`, `backend-hardening`, `security-audit`, `observability-audit`, `performance-audit`, `clean-code-review`, `library-selection`, `production-verification`). Invócalas por nombre para auditorías o implementación compleja.
- **Comandos verificados** (`package.json`): `yarn type-check` · `yarn type-check:tests` · `yarn lint` · `yarn format:check` · `yarn test` / `test:unit` · `yarn build` · `yarn smoke:*` · gates `yarn check:*`.
- **Evidencia:** no declares una fase terminada sin ejecutar los gates aplicables y conservar su resultado. No inventes comandos, librerías ni endpoints. No expongas secretos ni ejecutes operaciones destructivas de DB sin aprobación.
- **Catálogo de plugins y su selección:** `docs/claude/plugin-selection-matrix.md` (ninguna instalación con MCP/hooks se ejecuta sin aprobación humana).
