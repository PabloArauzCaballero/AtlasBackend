# Informe de instalación — Claude Code (Atlas)

- **Fecha:** 2026-07-21

## Plugins instalados

**Ninguno.** `claude plugin list` → *No plugins installed*. Por la regla dura de la orden maestra (§7), ningún plugin con MCP/hooks/LSP/binario global se instala sin aprobación humana, y esta corrida fue autónoma. Ver comandos listos en `plugin-selection-matrix.md`.

## Estructura creada / modificada en esta corrida

- **Creado** `.claude/rules/`: `10-typescript-backend.md`, `80-database.md`, `30-security.md`, `60-testing.md`.
- **Creado** `.claude/skills/` (8 skills): `backend-production`, `backend-hardening`, `clean-code-review`, `security-audit`, `observability-audit`, `performance-audit`, `library-selection`, `production-verification`.
- **Modificado** `CLAUDE.md`: añadida sección "Skills y reglas del proyecto" (secciones graphify intactas).
- **Creado** `docs/claude/`: `environment-inventory.md`, `current-configuration-audit.md`, `plugin-selection-matrix.md`, `skills-traceability.md`, `installation-report.md`, `validation-report.md`, `usage-guide.md`.
- **No modificados:** `.claude/settings.json`, `.claude/settings.local.json`.

## Pendiente de aprobación humana

| Acción | Comando | Prerrequisito |
|---|---|---|
| LSP TypeScript | `npm i -g typescript-language-server typescript` + `claude plugin install typescript-lsp@… --scope user` | Política de globales del equipo |
| Guía de seguridad | `claude plugin install security-guidance@… --scope user` | Revisar hooks (Python) |
| Docs por versión | `claude plugin install context7@… --scope user` | Revisar MCP |
| GitHub | `claude plugin install github@… --scope user` | Token de permisos mínimos |
| SAST en editor | `semgrep` **o** `aikido` | Elegir uno; deduplicar con CodeQL |

## Riesgos

- Instalar plugins con MCP/hooks ejecuta código externo: revisar fuente y usar credenciales de mínimo privilegio.
- `CLAUDE.md` y `.claude/` están sin commitear en esta rama: para compartirse con el equipo deben commitearse.
