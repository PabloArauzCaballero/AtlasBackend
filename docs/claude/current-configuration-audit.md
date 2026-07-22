# Auditoría de configuración Claude Code existente — Atlas

- **Fecha:** 2026-07-21

## Inventario previo (antes de esta corrida)

| Ruta | Estado |
|---|---|
| `CLAUDE.md` (raíz) | Existía con dos secciones `## graphify` (global + reglas Atlas). **Conservado íntegro**; solo se añadió al final la sección "Skills y reglas del proyecto". |
| `~/.claude/CLAUDE.md` | Global del usuario (graphify). No modificado. |
| `.claude/settings.json`, `.claude/settings.local.json` | Presentes (config estándar de Claude Code). **No modificados.** |
| `.claude/rules/`, `.claude/skills/`, `.claude/agents/` | No existían. **Creados** rules/ y skills/ en esta corrida. |
| `.mcp.json` | No existe. |
| `index.md`, `programacionGeneral.md`, `programacionBackend.md` | **No existen** en el repo (la orden maestra los asume). Registrados como faltantes. |
| `claude_backend_skills_recomendadas.json` | Presente (catálogo de plugins). |

## Conflictos / duplicaciones / riesgos

- **Sin conflictos** detectados entre `CLAUDE.md` y las nuevas reglas: `CLAUDE.md` mantiene hechos estables y remite a `.claude/rules/` y `.claude/skills/` para el detalle (evita duplicación semántica).
- **Riesgo menor:** `CLAUDE.md` aparece como *untracked* en git en esta rama. Recomendación: commitearlo para que las instrucciones del proyecto se compartan.
- **`settings.json` / `settings.local.json` NO se tocaron** (no se instaló ningún plugin); no hay `enabledPlugins` que fusionar en esta corrida.

## Contenido conservado (no sobrescribir)

- Ambas secciones graphify de `CLAUDE.md`.
- `.claude/settings*.json` tal cual.

## Recomendaciones

1. Commitear `CLAUDE.md`, `.claude/rules/`, `.claude/skills/` y `docs/claude/`.
2. Cuando se aprueben plugins, fusionar `enabledPlugins` en `.claude/settings.json` (no reemplazar) y revisar el diff.
3. Mantener los procedimientos largos en skills y los hechos estables en `CLAUDE.md` (<120 líneas).
