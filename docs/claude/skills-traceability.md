# Trazabilidad de skills — Atlas

- **Fecha:** 2026-07-21

| Skill | Capacidad | Fuente | Origen | Evidencia |
|---|---|---|---|---|
| `backend-production` | Implementación end-to-end con gates | `CLAUDE_ORGANIZAR_SKILLS_BACKEND.md` §11; `.claude/rules/` | Orden maestra + código real (patrón controller→service→repository→mapper) | `package.json` scripts; `src/modules/*` |
| `backend-hardening` | Auditoría por fases | Orden maestra §11 | Metodología de la auditoría 2026-07-21 | `docs/audit/revision-completa-backend-2026-07-21.md` |
| `clean-code-review` | Revisión Clean Code/arquitectura | Orden maestra §11; `10-typescript-backend.md` | Sección Arquitectura de la auditoría | Auditoría 2026-07-21 (8/10) |
| `security-audit` | Auditoría de seguridad | Orden maestra §11; `30-security.md` | Sección Seguridad de la auditoría | `src/modules/auth`, `src/common/utils/crypto` |
| `observability-audit` | Auditoría de observabilidad | Orden maestra §11 | Sección Observabilidad | `src/common/observability`, `ops/observability` |
| `performance-audit` | Auditoría de rendimiento (estática) | Orden maestra §11 | Sección Rendimiento | `scripts/stress`, `database.config.ts` |
| `library-selection` | Matriz de decisión de librerías | Orden maestra §11 | Regla anti-solapamiento | `package.json`, `yarn.lock` |
| `production-verification` | Gates reales de producción | Orden maestra §11; `60-testing.md` | Matriz de gates de CI | `.github/workflows/ci.yml`, `jest.config.cjs` |

**Reglas modulares** (`.claude/rules/`): `10-typescript-backend.md`, `80-database.md`, `30-security.md`, `60-testing.md` — todas con frontmatter `paths` y trazabilidad a la auditoría 2026-07-21 y al código real.

**Nota de derechos.** No se copiaron fragmentos extensos de libros/documentos protegidos; las skills resumen principios y citan la fuente.
