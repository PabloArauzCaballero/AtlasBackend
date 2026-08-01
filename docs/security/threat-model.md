# Threat model (STRIDE) — AtlasBackend

Modelo de amenazas del backend BNPL. Metodología **STRIDE** por categoría, con el
control vigente y el gap conocido (cuando lo hay). Es un documento vivo: se actualiza al
añadir superficie de ataque o cambiar un control.

- **Última revisión:** 2026-07-16
- **Alcance:** API NestJS (`/api/v1`), PostgreSQL, Redis (rate limit), Mongo (visor de
  logs opcional), integraciones salientes (MailSender, proveedores de notificación,
  proveedores de datos externos).

## Activos a proteger

1. **PII de clientes** (identidad, contacto) — cifrada en reposo.
2. **Datos financieros / de riesgo** (scoring, fraude).
3. **Credenciales y secretos** (JWT secret, claves de cifrado, credenciales de DB,
   API keys de proveedores).
4. **Integridad de la auditoría** (registro de acciones).
5. **Disponibilidad** de la API.

## Diagrama de confianza (límites)

```
[Cliente / Portal interno]  --HTTPS-->  [API NestJS /api/v1]
                                          |  |  |
                     (rw/ro roles)  PostgreSQL  Redis (rate limit)  Mongo (visor logs, opcional)
                                          |
                        [Proveedores externos: MailSender, notif, external-data]  (salida)
```

Límites de confianza: Internet↔API, API↔DB (roles diferenciados), API↔proveedores
externos (salida controlada).

### Superficie añadida por la separación de roles de proceso (2026-07-31)

Desde la separación `APP_ROLE` (ver [ADR-0006](../adr/0006-separacion-de-roles-api-worker.md)) el
sistema despliega **tres procesos** desde una sola imagen, y eso mueve el límite de confianza:

```
                       ┌── ZONA PÚBLICA ──┐   ┌──────────── RED PRIVADA ────────────┐
[Cliente / Portal] --HTTPS--> [Balanceador] --> [api    · APP_ROLE=api    · :3005]
                                                [worker · APP_ROLE=worker · :3006]  ← NO publicado
                                                [migrate· one-shot · atlas_migrator] ← DDL, y termina
[Prometheus] --scrape--> api:/metrics , worker:3006/metrics
```

| Elemento nuevo | Riesgo que introduce | Control vigente |
|---|---|---|
| Proceso `worker` | Ejecuta trabajo de fondo con el mismo acceso a datos que la API, sin que ninguna petición HTTP lo audite | Cada ejecución queda en `system_job_runs` con actor `runtime-jobs-scheduler`; lock de líder por Redis; nunca corre en `dryRun` |
| Sonda del worker (`:3006`) | Expone `/metrics` **sin autenticación de aplicación** | No se publica en `docker-compose.prod.yml` (`expose`, no `ports`). Sólo responde `GET` y sólo a tres rutas; cualquier otra devuelve 404 |
| Entrypoint equivocado en un despliegue | Montaría la API de negocio completa en un contenedor que el manifiesto trata como interno | `main.ts` **aborta** con `APP_ROLE=worker` y `worker.ts` aborta con `APP_ROLE=api`. El worker usa `createApplicationContext()`: los controllers no existen en ese proceso. Verificado en vivo (`/customers` → 404) |
| `NOTIFICATIONS_DELIVERY_MODE=deferred` sin worker | Los mensajes se persisten y **nadie los entrega**: la API responde 200 y el cliente no recibe nada | El default es `inline`; alerta `AtlasPendingNotificationDeliveryJobNotRunning` |
| Ausencia de un rol | Fallo **silencioso**: el outbox deja de despacharse y la retención de PII deja de aplicarse sin ningún error visible | `atlas_app_info{role}` + `AtlasWorkerRoleAbsent` / `AtlasApiRoleAbsent` |
| Manifiesto de producción | Despliegue a medias con secretos de ejemplo | Aborta si falta cualquier variable obligatoria; CI verifica que **falla** sin ellas |
| Imagen de contenedor | Escalada de privilegios desde el contenedor | Usuario sin privilegios (verificado en CI), sin devDependencies, `read_only` con `tmpfs` sólo en `/tmp`, `no-new-privileges`, y sin `curl` instalado |
| Job `migrate` con DDL | Es la única identidad con privilegios de esquema | Corre una vez y termina; `api` y `worker` no arrancan hasta que sale con código 0, y usan `atlas_app_rw` sin DDL |

---

## S — Spoofing (suplantación)

| Amenaza | Control vigente | Gap / seguimiento |
|---------|-----------------|-------------------|
| Robo/reuso de token de sesión | JWT corto + `tokenVersion` (revocación inmediata); refresh opaco, hasheado y rotado | — |
| Fuerza bruta de credenciales | Lockout 5 intentos/15 min; rate limit en login | — |
| Falta de segundo factor | **2FA obligatorio para internos** + **MFA opt-in para clientes** (OTP por correo, Fase 4.2) | Entrega SMS para clientes con login por teléfono + códigos de recuperación pendientes |
| Suplantación de servicio externo | Config de proveedores validada; SSL forzado a DB en prod | Verificar TLS/pinning en salidas a proveedores |

## T — Tampering (manipulación)

| Amenaza | Control vigente | Gap / seguimiento |
|---------|-----------------|-------------------|
| Alteración de datos en tránsito | HTTPS; `DB_SSL_REJECT_UNAUTHORIZED` forzado en prod | — |
| Escritura no autorizada en DB | Rol runtime `atlas_app_rw` sin DDL; `atlas_app_ro` solo lectura | — |
| Inyección (SQL/otros) | ORM (Sequelize) parametrizado; validación de entrada con Zod; **CodeQL** en CI | — |
| Manipulación del outbox/eventos | Outbox en la misma transacción de negocio ([ADR-0001](../adr/0001-outbox-en-postgresql.md)) | Alertas de backlog pendientes (Fase 3.4) |

## R — Repudiation (repudio)

| Amenaza | Control vigente | Gap / seguimiento |
|---------|-----------------|-------------------|
| Un actor niega una acción | Módulo de auditoría con feed por cursor; auditoría HTTP redactada | Retención/no-PII en logs de aplicación por reforzar (Fase 3.2) |
| Pérdida de trazas por caída | Auditoría persistida en PostgreSQL (durable) | — |

## I — Information disclosure (divulgación)

| Amenaza | Control vigente | Gap / seguimiento |
|---------|-----------------|-------------------|
| Fuga de PII en reposo | Envelope encryption AES-256-GCM; **KMS activo cuando está configurado** ([ADR-0004](../adr/0004-kms-envelope-encryption.md)) | Corte a KMS en prod requiere `@aws-sdk/client-kms` + rotación probada en staging |
| Secretos en el repo/historial | **gitleaks** en CI; validación que rechaza `.env` commiteado | — |
| PII/secretos en logs | Auditoría HTTP redactada; política no-PII | Control automático de patrones sensibles en logs pendiente (Fase 3.2) |
| Overfetching en capa de lectura | Gate `check:overfetching` (sin `SELECT *` en `read_api`) | — |
| Swagger expuesto en prod | `API_DOCS_ENABLED` requiere activación explícita en prod | — |

## D — Denial of service

| Amenaza | Control vigente | Gap / seguimiento |
|---------|-----------------|-------------------|
| Flood de requests | Rate limiting; **Redis distribuido obligatorio en prod** ([ADR-0002](../adr/0002-redis-solo-en-produccion.md)) | Rate limits por endpoint/rol más granulares (Fase 4.3) |
| Payloads gigantes | `API_JSON_BODY_LIMIT` (def. 2mb) | — |
| Agotamiento por consultas caras | Paginación por cursor en alto volumen ([ADR-0005](../adr/0005-paginacion-por-cursor.md)) | — |
| DoS volumétrico de red | Fuera del backend | Depende de WAF/plataforma (documentado en incident-response) |

## E — Elevation of privilege

| Amenaza | Control vigente | Gap / seguimiento |
|---------|-----------------|-------------------|
| Escalada a DDL desde el runtime | `atlas_app_rw` sin permisos DDL; matriz verificada en CI (`check:db-privileges`) | — |
| Escalada de rol de aplicación | RBAC de administración (`docs/security/admin-rbac-matrix.md`) | Revisión periódica de la matriz |
| Abuso de credencial de migración | `atlas_migrator` separado, no lo usa el runtime | — |

---

## Riesgos residuales priorizados

1. **Entrega de OTP de cliente solo por correo** (S) — 2FA interno obligatorio y MFA opt-in de
   cliente ya implementados (OTP por correo); falta entrega por SMS (login por teléfono) y códigos
   de recuperación. → Fase 4.2.
2. **Retención/no-PII en logs sin control automático** (R/I) — política escrita, falta
   el lint/test que la haga cumplir. → Fase 3.2.
3. **Rate limits no granulares por endpoint/rol** (D) — hoy global. → Fase 4.3.
4. **Observabilidad de SLO casi completa** (D/T) — Fase 3.4: métricas Prometheus
   (`GET /metrics`), trazas OpenTelemetry opt-in, y **dashboards + reglas de alerta** en
   `ops/observability/` (error 5xx, p95/p99, target down). Falta instrumentar las **métricas de
   negocio** (backlog de outbox, breaker abierto, costo por proveedor) en sus servicios.
