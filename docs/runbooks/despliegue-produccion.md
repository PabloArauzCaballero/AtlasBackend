# Runbook: checklist de despliegue a producción

Pasos para llevar AtlasBackend a producción de forma segura. Derivado de las validaciones que el
propio `src/config/env.ts` hace al arrancar (el proceso **se niega a iniciar** si faltan) y de las
features añadidas en las Fases 3.3/3.4/4.2 del plan 10/10.

## 1. Variables de entorno obligatorias en producción

El arranque **falla con un mensaje claro** si alguna de estas no está bien configurada
(`NODE_ENV=production`):

- [ ] `JWT_ACCESS_TOKEN_SECRET` — un secreto real (≥32 chars), **no** el valor por defecto.
- [ ] `NOTIFICATION_TOKEN_ENCRYPTION_KEY` — real, **distinto** del de ejemplo y **distinto** de
      `JWT_ACCESS_TOKEN_SECRET`.
- [ ] `REDIS_URL` — **requerido**: sin Redis el rate limiting solo protege por instancia
      (ver [ADR-0002](../adr/0002-redis-solo-en-produccion.md)).
- [ ] `DB_SSL=true` con `DB_SSL_REJECT_UNAUTHORIZED=true` (validación de certificado de PostgreSQL).
- [ ] `CORS_ORIGINS` / `INTERNAL_FRONTEND_ORIGIN` apuntando a los orígenes reales del frontend.

## 2. Base de datos: migraciones

- [ ] Correr `yarn db:migration:up` con la identidad de migración (`DB_MIGRATION_USER`, sin que el
      runtime `atlas_app_rw` tenga DDL).
- [ ] Incluye la migración **`mfa_enabled` en `auth_credentials`** (Fase 4.2, columna booleana con
      default `false` — no afecta a credenciales existentes).
- [ ] Bootstrap de roles de mínimo privilegio: `ops/postgres/bootstrap-roles.sql` + `grants.sql`,
      verificado con `yarn check:db-privileges`.

## 3. Cifrado de PII con KMS (Fase 3.3)

Opcional pero **recomendado en producción** (el proveedor `local` protege con una master key local,
no con un HSM):

- [ ] Instalar `@aws-sdk/client-kms` en la imagen final (el proveedor lo importa dinámicamente; sin
      él, con KMS configurado, las escrituras de PII fallan).
- [ ] Configurar `KMS_KEY_ID` (ARN/alias de la CMK) + `AWS_REGION`.
- [ ] Probar la rotación en staging con el [runbook de rotación](rotacion-de-claves.md) antes del
      corte. Los valores previos cifrados con `local` se siguen descifrando.

## 4. Segundo factor (Fase 4.2)

- [ ] Configurar **MailSender** (`MAILSENDER_BASE_URL` + credenciales): sin correo, el 2FA interno
      cae a login de un paso y los clientes no pueden activar MFA.
- [ ] `AUTH_LOGIN_PIN_ENABLED=true` (default) para exigir 2FA a los actores internos.
- [ ] Nota: el OTP de cliente se entrega por correo; SMS y códigos de recuperación son seguimiento.

## 5. Observabilidad (Fase 3.4)

- [ ] `METRICS_ENABLED=true` (default). **Restringir `GET /metrics` a la red interna de scrape** —
      no exponerlo a internet (no lleva auth de aplicación).
- [ ] Trazas OpenTelemetry (opcional): `OTEL_ENABLED=true` + `OTEL_EXPORTER_OTLP_ENDPOINT` apuntando
      al collector. Apagado por defecto (cero coste).
- [ ] Configurar dashboards/alertas sobre las series de latencia y error (pendiente de la Fase 3.4).

## 6. Logs

- [ ] Definir retención en el destino de logs y, si se usa el visor Mongo, acotar su retención
      (`MONGO_DB_URL_CONNECTION`; ver [ADR-0003](../adr/0003-mongo-log-sync.md)). Sin PII en logs.

## 7. Gates que deben estar verdes antes de desplegar

`lint`, `format:check`, `type-check`, `test:unit`, `test:coverage` (gate por trinquete), `build`,
`check:file-size`, `codeql`, `secret-scan`, `yarn audit --level high`, y el job de integración
(migraciones + seeders + smoke contra Postgres/Redis reales). Ver `.github/workflows/ci.yml`.

## 8. Post-despliegue

- [ ] Smoke de salud: `GET /api/v1/health`.
- [ ] Smoke de auth (login, refresh) y un envío de notificación de prueba.
- [ ] Verificar que `GET /metrics` responde formato Prometheus desde la red de scrape.
- [ ] Confirmar que la traza end-to-end aparece en el collector (si `OTEL_ENABLED`).
