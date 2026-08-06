---
title: "Modelo de amenazas"
type: "security"
status: "verified"
owner: "unknown"
criticality: "critical"
last_reviewed: "2026-08-06"
source_revision: "80fc741"
tags:
  - backend
  - security
  - threats
aliases: []
related: []
---
# Modelo de amenazas

Modelo documental derivado del código. **No** sustituye una prueba de penetración.

## Activos

| Activo | Dónde | Impacto si se compromete |
|---|---|---|
| PII de clientes | `customer`, `privacy`, `telemetry` | **Crítico** — regulatorio y reputacional |
| Credenciales | `iam.auth_credentials` (argon2) | Crítico |
| Secreto de firma JWT | Variable de entorno | **Crítico** — permite emitir cualquier rol |
| Clave maestra de PII | KMS o variable | **Crítico** — descifra todo |
| Decisiones de riesgo | `risk` | Alto — fraude si se manipulan |
| Evidencia documental | S3 + `privacy` | Alto |
| Rastro de auditoría | `audit` | Alto — su pérdida impide investigar |

## Actores hostiles

| Actor | Capacidad |
|---|---|
| Anónimo en Internet | Alcanza 16 rutas públicas |
| Cliente autenticado | Token válido con rol `customer` |
| Operador interno comprometido | Acceso legítimo amplio |
| Proveedor externo comprometido | Devuelve datos manipulados |
| Con acceso a la red interna | Alcanza `/metrics`, sonda del worker y almacenes |

## Amenazas y controles

| # | Amenaza | Control | Estado |
|---|---|---|---|
| T-01 | Fuerza bruta de credenciales | `@Throttle` estricto + bloqueo tras 5 intentos, 15 min | ✅ |
| T-02 | Robo de token | Vigencia 1 h + revocación por `tokenVersion` + cookie `Secure` | ✅ |
| T-03 | Falsificación de token | HS256 fijado + `issuer`/`audience` + rol validado contra la constante | ✅ |
| T-04 | **BOLA** — leer datos de otro cliente | `assertOwnCustomerResource` centralizado | ✅ |
| T-05 | **BFLA** — invocar función de otro rol | `RolesGuard` sobre `@Roles` | ⚠️ una ruta sin `@Roles` queda abierta a todo autenticado |
| T-06 | Cruce de tenants | `TenantGuard` + filtro por `_tenant_id` | ⚠️ el guard no **exige** el tenant — [[14-audits/risks-register\|SEC-001]] |
| T-07 | Inyección SQL | `replacements` parametrizados + allowlist de columnas | ✅ |
| T-08 | Inyección NoSQL | `escapeRegex` en consultas Mongo | ✅ |
| T-09 | Fuga de PII por logs | Redacción + **SQL nunca registrado** | ✅ |
| T-10 | Fuga de PII por respuesta | Mapper a DTO + gate de sobrelectura | ✅ |
| T-11 | Malware en subidas | Análisis antes de almacenar | ✅ |
| T-12 | Reconocimiento vía `/metrics` | Depende del aislamiento de red | ⚠️ no verificable desde el código |
| T-13 | Robo de la clave de PII | KMS si está configurado | ⚠️ [[14-audits/risks-register\|SEC-002]] |
| T-14 | Comando duplicado / replay | Clave de idempotencia + hash del cuerpo | ✅ |
| T-15 | Agotamiento de recursos | Rate limiting + timeout + límite de cuerpo (2 MB) + circuit breaker | ✅ |
| T-16 | Escalada vía DDL desde el runtime | Identidad de runtime **sin** privilegios de DDL | ✅ |
| T-17 | Manipulación de decisión de riesgo | Auditoría + versionado de reglas y modelos | ✅ |
| T-18 | Borrado de evidencia | Sin `CASCADE`; `RESTRICT` lo impide | ✅ |
| T-19 | SSRF vía proveedores | `NO_CONFIRMADO` — no se verificó validación de URL de destino | ❓ |
| T-20 | Dependencias vulnerables | `PENDIENTE` — `yarn audit` no se ejecutó | ❓ |

## Fronteras

Ver [[02-architecture/trust-boundaries]].

## Abuso, no solo ataque

| Caso | Control |
|---|---|
| Enumerar clientes por id | Identificadores públicos son UUID/código, no el `_id` secuencial |
| Agotar cuota de proveedor externo | Políticas de coste + circuit breaker |
| Spam de notificaciones | Cooldown por destino |
| Operador interno consultando de más | Auditoría por acción; `customer_action_logs` |

## Relaciones

- [[08-security/security-overview]] · [[08-security/abuse-cases]] · [[14-audits/risks-register]]
