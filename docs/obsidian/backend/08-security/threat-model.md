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
| T-19 | **SSRF** vía URL suministrada por el cliente | Allowlist de host por entorno + bloqueo de metadata + rangos privados + **verificación DNS** | ✅ ver abajo |
| T-20 | Dependencias vulnerables | `PENDIENTE` — `yarn audit` no se ejecutó | ❓ |

## T-19 en detalle — la única URL que controla el cliente

`VERIFICADO` — el único punto donde una URL suministrada por el cliente dirige una petición saliente es `baseUrl` en los endpoints de pruebas de sistema (`systems-ops.schemas.ts`). Está defendido en `src/modules/systems-ops/systems-test-url-policy.util.ts`, que aplica en cadena:

| Control | Qué rechaza |
|---|---|
| Protocolo | Todo lo que no sea `http:`/`https:` |
| Credenciales embebidas | `user:pass@host` |
| **Allowlist por entorno** | Host que no esté en `SYSTEM_TEST_ALLOWED_HOSTS_{LOCAL,STAGING,PRODUCTION_READONLY}` |
| Metadata cloud | `169.254.169.254` (AWS/GCP), `169.254.170.2` (ECS), `metadata.google.internal` |
| Rangos privados | `10/8`, `127/8`, `172.16–31`, `192.168`, `169.254`, `0.x`, IPv6 loopback/link-local/ULA |
| **Resolución DNS** | `assertResolvedTargetSafe` resuelve el host y rechaza si **alguna** dirección resuelta es interna |
| Ruta | `path` debe ser relativo y no empezar por `//` |

> [!info] La verificación DNS es lo que cierra el rebinding
> Validar solo el *hostname* deja abierto el DNS rebinding: un dominio en la allowlist puede resolver a `169.254.169.254`. `assertResolvedTargetSafe` comprueba las **direcciones resueltas**, no el nombre, y exige que ninguna sea interna.
>
> Los defaults refuerzan el fail-closed: `SYSTEM_TEST_ALLOWED_HOSTS_STAGING` y `..._PRODUCTION_READONLY` vienen **vacíos**. Sin configuración explícita, ningún host es alcanzable fuera de local.

Los demás destinos salientes (proveedores externos, S3) se configuran por **variable de entorno**, no por petición: no son vector de SSRF, aunque tampoco tienen allowlist de host. `artifactUrl` en `catalog-management` solo se **almacena**; no se descarga.

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
