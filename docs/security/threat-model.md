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

---

## S — Spoofing (suplantación)

| Amenaza | Control vigente | Gap / seguimiento |
|---------|-----------------|-------------------|
| Robo/reuso de token de sesión | JWT corto + `tokenVersion` (revocación inmediata); refresh opaco, hasheado y rotado | — |
| Fuerza bruta de credenciales | Lockout 5 intentos/15 min; rate limit en login | — |
| Falta de segundo factor | **2FA obligatorio para actores internos** (PIN por correo, Fase 4.2); password + one-time codes | MFA/OTP para clientes aún pendiente (Fase 4.2) |
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

1. **MFA de clientes pendiente** (S) — el 2FA de roles internos ya es obligatorio (PIN por
   correo); falta el segundo factor opcional del lado cliente. → Fase 4.2.
2. **Retención/no-PII en logs sin control automático** (R/I) — política escrita, falta
   el lint/test que la haga cumplir. → Fase 3.2.
3. **Rate limits no granulares por endpoint/rol** (D) — hoy global. → Fase 4.3.
4. **Observabilidad de SLO parcial** (D/T) — Fase 3.4 en curso: métricas Prometheus
   (`GET /metrics`: latencia p50/p95/p99 e índice de error por ruta) y trazas OpenTelemetry
   opt-in ya implementadas. Falta cablear dashboards/alertas sobre esas señales y las métricas
   de negocio (backlog de outbox, breaker abierto).
