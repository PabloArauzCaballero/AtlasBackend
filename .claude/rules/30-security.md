---
paths:
  - "src/**/*.ts"
  - "ops/**"
---

# Seguridad

Fuente: `docs/audit/revision-completa-backend-2026-07-21.md` (sección Seguridad) + código real.

- **Nunca loguear secretos ni PII en claro.** Los payloads persistidos (audit/telemetría) pasan por `redactSensitiveObject`; el logger de archivo aplica `redactSensitiveText`. En un backend KYC, nombre/email/teléfono/`identifier` son PII.
- **Nunca loguear SQL** (Sequelize inlinea valores → fuga de PII). El filtro global saneó el 5xx al cliente pero loguea la causa del driver sin el SQL.
- **JWT:** algoritmo fijado (HS256) al firmar y verificar. En producción, rechazar tokens sin `tokenVersion`/actor.
- **Rate limiting:** `@Throttle` estricto en endpoints públicos de auth (login, password-reset, refresh). Cooldown por destino en el envío de correos/códigos.
- **Autorización:** ownership anti-BOLA centralizado (`ownership.util.ts`); `TenantGuard` cruza `x-tenant-id` contra el token. Todo recurso por-id valida pertenencia.
- **Inyección:** SQL crudo solo con `replacements` parametrizados y allowlist de columnas; Mongo con `escapeRegex`.
- **Secretos:** `.env` nunca versionado (gate `check:no-env-file`). Defaults de dev bloqueados en producción por Zod. En producción exigir/advertir KMS.
- **Endpoints de infra** (`/metrics`) sin auth de app deben ir tras red aislada y `@SkipThrottle`.
- **Detente para:** OAuth, uso de secretos reales, acceso a producción, `git push`, migraciones destructivas, recursos cloud.

**Evidencia:** `/security-review` sobre el diff, `yarn audit --level high`, smokes de auth/rbac.
