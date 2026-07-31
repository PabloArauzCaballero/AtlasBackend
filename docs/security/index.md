# Seguridad

| Si buscas | Ve a |
|---|---|
| Amenazas y mitigaciones | [Modelo de amenazas](threat-model.md) |
| Quién puede hacer qué | [Actores y roles](../business/actors-and-roles.md) |
| Cómo se protege el dato personal | [Retención y clasificación](../data/retention.md) |
| La política de reporte | [SECURITY.md](../../SECURITY.md) |

## Controles activos

| Control | Dónde |
|---|---|
| JWT HS256 con `iss` y `aud` verificados | `jwt-claims.util.ts`, aplicado en los 8 puntos que firman o verifican |
| Aislamiento de tenant | `TenantGuard` en los 17 controllers con `x-tenant-id` |
| Autorización por rol | `RolesGuard` + `@Roles(...)` |
| Anti-BOLA | `ownership.util.ts`, centralizado |
| Validación de entrada | Zod en todo endpoint público |
| Rate limiting | Throttler global + límites estrictos en auth |
| PII redactada en logs | `redactSensitiveObject` / `redactSensitiveText`, también en stdout |
| Query string saneada en logs | `sanitizeUrlForLog`: conserva nombres, descarta valores |
| Cifrado de sobre con KMS | `envelope-encryption.util.ts` + `KmsKeyProvider` |
| Sin datos simulados en producción | `productionIntegrationBlockers` |
| Imagen sin root, sin devDependencies, `read_only` | `Dockerfile`, `docker-compose.prod.yml` |
| Secretos fuera del repositorio | `yarn check:no-env-file` + gitleaks en CI |

## Gates de seguridad en CI

`codeql`, `gitleaks`, SBOM, `yarn audit --level high`, `yarn check:db-privileges --strict`,
`yarn check:no-env-file`, y el build de la imagen con verificación de que no corre como root.
