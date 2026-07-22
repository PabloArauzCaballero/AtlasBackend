---
name: security-audit
description: Auditoría de seguridad del backend Atlas (autenticación, autorización/BOLA-BFLA, validación, inyección, secretos/KMS, rate limiting, logs sensibles, webhooks/SSRF, idempotencia, dependencias). Úsala para revisar riesgos de seguridad sin modificar código, con evidencia archivo:línea.
---

# security-audit

**Propósito.** Detectar y priorizar riesgos de seguridad con evidencia.

**Cuándo usarla.** Antes de exponer endpoints, tras cambios en auth/crypto/datos, o en una revisión de seguridad periódica.
**Cuándo NO.** Para el análisis de calidad/estilo (usa `clean-code-review`).

**Fuentes obligatorias.** `src/modules/auth/`, `src/common/utils/crypto/`, `src/common/**` (guards, filters, interceptors, middleware), `src/config/env.ts`, `.env.example`, `package.json`, `docs/audit/`.

**Entradas.** Alcance opcional. Sin entrada, audita todo el backend.

**Condiciones de parada.** Detente si un paso exigiera secretos reales, OAuth, acceso a producción o ejecutar exploits reales.

**Flujo por fases.**
1. Autenticación: firma/verificación JWT (algoritmo fijado), expiración, refresh tokens (rotación, detección de reuso), almacenamiento de credenciales (Argon2id), one-time codes.
2. Autorización: guards, RBAC, BOLA/BFLA (¿se valida pertenencia del recurso al actor?).
3. Validación: Zod en todos los endpoints; entradas sin validar.
4. Inyección: SQL crudo (¿`replacements`? ¿allowlist de columnas?), NoSQL.
5. Secretos/KMS: env, defaults bloqueados en prod, envelope encryption, KMS.
6. Rate limiting: `@Throttle` en login/OTP/reset; cooldown por destino.
7. Logs sensibles: redacción consistente; nunca SQL; PII en texto libre.
8. Webhooks/adapters: firma HMAC, SSRF (URLs configurables).
9. Idempotencia y dependencias (`yarn audit`).

**Comandos permitidos.** Lectura, grep, `graphify`, `yarn audit --level high`, `/security-review` sobre el diff.
**Comandos prohibidos.** Exploits reales, uso de secretos, acceso a producción.

**Evidencia requerida.** Cada hallazgo con `archivo:línea`, severidad, impacto y recomendación. `yarn audit` con su salida.

**Entregables.** Informe: resumen ejecutivo, hallazgos por severidad, aspectos positivos, no verificado.

**Formato.** `[SEVERIDAD] título — archivo:línea — evidencia — impacto — recomendación`.

**Checklist final.** ¿Auth, authz, validación, inyección, secretos, rate limit, logs, webhooks, deps cubiertos? ¿Cada hallazgo con evidencia? ¿Falsos positivos descartados?

**Limitaciones.** Estática; no prueba endpoints en vivo ni valida config real de producción.

**Trazabilidad.** `CLAUDE_ORGANIZAR_SKILLS_BACKEND.md` §11 (security-audit) + auditoría 2026-07-21 (sección Seguridad).
