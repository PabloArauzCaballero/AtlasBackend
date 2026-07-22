# Matriz de selección de plugins — Claude Code (Atlas)

- **Fecha:** 2026-07-21
- **Estado real del entorno:** `claude plugin list` → *No plugins installed*. Ninguna instalación se ejecutó en esta corrida.
- **Regla dura (orden maestra §7):** todo plugin con MCP, hooks, LSP o binario global requiere **aprobación humana** antes de instalarse. Aquí solo se documentan las decisiones y los comandos listos para copiar.

## Decisiones (evaluadas contra el stack real)

| Plugin | Categoría | Componentes/Riesgo | Decisión | Justificación |
|---|---|---|---|---|
| `typescript-lsp` | Code intelligence | LSP + npm global (`typescript-language-server`) | **Instalar (requiere aprobación)** | Stack TS/NestJS; mejora diagnósticos. Verificar política de globales antes. |
| `security-guidance` | Seguridad | Hooks + Python | **Instalar (requiere aprobación)** | Revisión de seguridad del diff; complementa `/security-review`. Windows: revisión alternativa. |
| `context7` | Docs por versión | MCP | **Instalar (requiere aprobación)** | Apoya la skill `library-selection` (docs de la versión fijada). Revisar fuente MCP. |
| `github` | Delivery | MCP + token | **Instalar (requiere aprobación)** | Repo en GitHub; token de permisos mínimos, sin escritura directa a `main`. |
| `code-simplifier` | Clean code | Skill | **Candidato (scope user)** | Bajo riesgo; complementa `/simplify`. |
| `claude-md-management` | Workflow IA | Skill | **Candidato (scope user)** | Mantiene `CLAUDE.md` estable; útil dado el trabajo de esta corrida. |
| `skill-creator` | Workflow IA | Skill | **Candidato (scope user)** | Para evolucionar las skills creadas en `.claude/skills/`. |
| `42crunch-api-security-testing` | Seguridad API | — | **Condicional** | Hay OpenAPI generado; útil si se publica el spec. Evaluar tras `docs:openapi`. |
| `redis-development` | Rendimiento | Skill | **Condicional** | Redis se usa; útil si se rediseña caché/TTL. |
| `postman` / `playwright` | API/E2E testing | MCP / browser | **Opcional** | Los smokes + supertest ya cubren API; instalar solo si se necesita E2E de navegador. |
| `semgrep` vs `aikido` | SAST | MCP/CLI | **Elegir uno (pendiente humano)** | Un solo SAST principal. `semgrep` con cautela en Windows nativo (WSL alternativa); ya hay CodeQL en CI. |
| Observabilidad (`sentry`/`datadog`/`grafana-*`) | Observabilidad | MCP | **grafana-mcp si acaso** | La observabilidad es Prometheus/Grafana self-hosted; no instalar Sentry/Datadog. |
| `neon` | DB | MCP | **Descartar** | No se usa Neon (Postgres self-managed). |
| `terraform` / `aws-dev-toolkit` | Infra | MCP | **Descartar** | Sin IaC ni despliegue AWS confirmado (KMS es opcional vía env). |
| `mcp-server-dev` / `plugin-dev` | Workflow IA | — | **Descartar por ahora** | No se está construyendo MCP/plugin propio. |

## Comandos listos (NO ejecutados — requieren aprobación)

```bash
# LSP (verificar antes la política de instalaciones globales):
npm install -g typescript-language-server typescript
claude plugin install typescript-lsp@claude-plugins-official --scope user

# Núcleo backend (bajo riesgo, scope user):
claude plugin install code-simplifier@claude-plugins-official --scope user
claude plugin install claude-md-management@claude-plugins-official --scope user
claude plugin install skill-creator@claude-plugins-official --scope user

# Con MCP/hooks/token (revisar fuente y permisos mínimos primero):
claude plugin install security-guidance@claude-plugins-official --scope user
claude plugin install context7@claude-plugins-official --scope user
claude plugin install github@claude-plugins-official --scope user
```

## Observabilidad SAST — decisión pendiente del equipo

- **SAST:** el repo ya corre **CodeQL** + **gitleaks** + `yarn audit` en CI. Añadir `semgrep`/`aikido` solo si se quiere feedback en el editor; elegir **uno** y definir deduplicación con CodeQL.
- **APM:** mantener Prometheus/Grafana; si se conecta un MCP, `grafana-mcp` (self-hosted) es el único coherente.
