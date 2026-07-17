# Política de seguridad

AtlasBackend es un backend fintech (BNPL) que maneja PII y datos financieros. La
seguridad es un requisito de primera clase, no un añadido. Este documento describe cómo
**reportar** una vulnerabilidad y las **prácticas y controles** vigentes.

## Reporte de vulnerabilidades (divulgación responsable)

**No abras un issue público** para una vulnerabilidad de seguridad.

- Repórtala de forma privada al equipo de seguridad del proyecto (canal privado del
  equipo / advisory privado de GitHub `Security` → `Report a vulnerability`).
- Incluye: descripción, impacto, pasos de reproducción y, si lo tienes, una prueba de
  concepto mínima.
- **Compromiso de respuesta (objetivo):**
  - Acuse de recibo: **≤ 72 horas**.
  - Evaluación inicial de severidad: **≤ 7 días**.
  - Corrección o plan de mitigación acordado según severidad.
- Pedimos **no divulgar públicamente** hasta que exista una corrección disponible y un
  plazo acordado. Reconoceremos tu aporte si así lo deseas.

> Ajusta los canales/plazos concretos a los del equipo antes de publicar externamente.

## Alcance

En alcance: el código de este repositorio, sus dependencias y su configuración de
despliegue. Fuera de alcance: infraestructura de terceros y proyectos hermanos
(p. ej. MailSender) que tienen su propio proceso.

## Controles de seguridad vigentes

### Autenticación y sesiones
- JWT de vida corta (`JWT_ACCESS_TOKEN_EXPIRES_IN`, def. 1h) con claim `tokenVersion`
  para **revocación inmediata**.
- Refresh tokens **opacos y hasheados** en base, con **rotación** en cada uso y
  `revokedAt`/`revokedReason`.
- **Lockout** por fuerza bruta: 5 intentos fallidos → bloqueo 15 min.
- Códigos de un solo uso (reset de contraseña, PIN de login de administradores) con TTL
  y máximo de intentos.
- Revocación de sesiones: ver
  [runbook de expiración/revocación](docs/runbooks/expiracion-y-revocacion-de-sesiones.md).
- **2FA obligatorio para actores internos (Fase 4.2):** todo login de `internal_user` /
  `platform_user` exige un segundo factor (PIN de un solo uso entregado por correo) cuando
  MailSender está configurado; sin correo cae a un paso, y `AUTH_LOGIN_PIN_ENABLED=false` lo
  desactiva (test).
- **MFA opt-in para clientes (Fase 4.2):** un cliente autenticado activa su segundo factor con
  `POST /auth/mfa` (`{ enabled }`); con MFA activo su login responde un desafío OTP por correo
  (mismo flujo que el PIN interno, completar con `POST /auth/login/pin`). Activar exige MailSender
  configurado (si no, no habría cómo entregar el OTP y el cliente quedaría bloqueado).

> Limitación conocida (Fase 4.2): el OTP de cliente se entrega por **correo** y requiere un email en
> claro (disponible cuando el cliente inicia sesión con su email). La entrega por **SMS** para
> clientes que inician con teléfono, y los **códigos de recuperación**, quedan como seguimiento.

### Cifrado
- PII y tokens de dispositivo cifrados en reposo con **envelope encryption**
  (AES-256-GCM, data key por valor), proveedor intercambiable `local`/KMS. Ver
  [ADR-0004](docs/adr/0004-kms-envelope-encryption.md).
- **KMS real cableado (Fase 3.3):** con `KMS_KEY_ID`+`AWS_REGION`, KMS es el proveedor de
  cifrado activo y las escrituras nuevas de PII usan data keys de AWS KMS. Requiere
  `@aws-sdk/client-kms` en la imagen y validación de rotación en staging antes del corte
  en prod.
- En producción, la validación de entorno **rechaza el arranque** con secretos de
  ejemplo o con `NOTIFICATION_TOKEN_ENCRYPTION_KEY == JWT_ACCESS_TOKEN_SECRET`.

### Transporte y base de datos
- En producción, `DB_SSL_REJECT_UNAUTHORIZED` debe permanecer activo (validación de
  certificado de PostgreSQL forzada por el schema de entorno).
- Separación de identidades PostgreSQL: `atlas_app_rw` (runtime, sin DDL),
  `atlas_app_ro` (solo lectura), `atlas_migrator` (DDL). Ver `docs/database`.

### Rate limiting
- Rate limiting distribuido respaldado por **Redis obligatorio en producción**
  ([ADR-0002](docs/adr/0002-redis-solo-en-produccion.md)).

### Logs y datos
- Los logs de aplicación **no deben contener PII ni secretos**. La auditoría HTTP se
  redacta. El visor de logs en Mongo es opcional y acotado
  ([ADR-0003](docs/adr/0003-mongo-log-sync.md)).

### Pipeline (gates automáticos en CI)
- **CodeQL** (SAST) con `security-extended`.
- **gitleaks** (escaneo de secretos en el working tree).
- **SBOM** CycloneDX por build.
- **`yarn audit --level high`** (CVEs de dependencias bloquean el merge).
- Ver [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Threat model

El modelo de amenazas STRIDE está en
[docs/security/threat-model.md](docs/security/threat-model.md).

## Respuesta a incidentes

Procedimiento en [docs/runbooks/incident-response.md](docs/runbooks/incident-response.md).
