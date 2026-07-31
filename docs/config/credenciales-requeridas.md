# Credenciales requeridas — qué falta configurar

**Todas las credenciales de este backend se configuran por variables de entorno (`.env`).** No hay
credenciales en base de datos, en código ni en archivos de configuración: el contrato completo está
en [`src/config/env.schema.ts`](../../src/config/env.schema.ts) (variables tipadas y validadas al
arrancar) y en `PRODUCTION_CREDENTIAL_REQUIREMENTS`
([`external-data-policy.util.ts`](../../src/modules/external-data/application/external-data-policy.util.ts))
para los proveedores externos.

Las plantillas a copiar son [`.env.example`](../../.env.example) (desarrollo) y
[`.env.production.example`](../../.env.production.example) (producción). El gate
`yarn check:env-example` falla si alguna variable del contrato falta en ellas, así que la plantilla
nunca se queda atrás del código.

> **Qué NO hace este documento:** no lista las ~148 variables de configuración (intervalos, límites,
> flags). Solo las **credenciales y secretos**: lo que hay que pedirle a alguien —un proveedor, un
> equipo de infraestructura, un gestor de secretos— y que hoy no está.

## Cómo leer las tablas

| Estado | Significado |
|---|---|
| 🔴 **Bloqueante** | Sin esto el proceso **no arranca** en producción. `env.ts` lo valida y falla con un mensaje explícito. |
| 🟠 **Funcionalidad apagada** | El proceso arranca, pero esa capacidad no existe. Es una degradación **explícita**, no silenciosa. |
| ⚪ **Sin efecto todavía** | La variable se exige para abrir un portón, pero **no hay código que la consuma**. Rellenarla no habilita nada. |

---

## 1. Bloqueantes en producción

Sin estas cuatro, `NODE_ENV=production` **no arranca**. Las valida
[`env-cross-checks.ts`](../../src/config/env-cross-checks.ts).

| Variable | Estado | Quién la provee | Qué pasa sin ella |
|---|---|---|---|
| `JWT_ACCESS_TOKEN_SECRET` | 🔴 | Generarla (≥32 chars aleatorios) | El arranque falla si es el valor por defecto de desarrollo. Es la clave que firma **todas** las sesiones. |
| `NOTIFICATION_TOKEN_ENCRYPTION_KEY` | 🔴 | Generarla (≥32 chars, **distinta** de la anterior) | El arranque falla si es la de ejemplo o si coincide con `JWT_ACCESS_TOKEN_SECRET`. Cifra los tokens de dispositivo para push. |
| `REDIS_URL` | 🔴 | Infraestructura | El arranque falla. Sin Redis el rate limiting solo protege por instancia, y la elección de líder del planificador no existe. |
| `DB_PASSWORD` | 🔴 | Infraestructura / gestor de secretos | Sin credencial no hay base de datos. Debe apuntar al rol `atlas_app_rw`, no al owner. |

Rotación de las dos claves criptográficas:
[`docs/runbooks/rotacion-de-claves.md`](../runbooks/rotacion-de-claves.md).

### Identidades PostgreSQL separadas

El runtime **no debe** poder alterar el esquema. Ver
[`docs/database/postgres-roles.md`](../database/postgres-roles.md).

| Variable | Estado | Qué pasa sin ella |
|---|---|---|
| `DB_MIGRATION_USER` / `DB_MIGRATION_PASSWORD` | 🟠 | Cae a `DB_USER`: migraciones y runtime comparten identidad y el privilegio mínimo del runtime es **ficticio**. Cómodo en local, incorrecto en producción. |
| `DB_READ_USER` / `DB_READ_PASSWORD` | 🟠 | Con `DB_READ_ENABLED=true` y sin estas, el pool de lectura cae al primario con credenciales de escritura. La degradación se registra al arrancar, no es silenciosa. |
| `DB_ADMIN_USER` / `DB_ADMIN_PASSWORD` | 🟠 | Solo las usa `yarn db:roles:bootstrap`. Sin ellas hay que crear los roles a mano. |
| `DB_APP_RW_PASSWORD`, `DB_APP_RO_PASSWORD`, `DB_MIGRATOR_PASSWORD` | 🟠 | Las contraseñas que `db:roles:bootstrap` asigna a cada rol. **No tienen valor por defecto a propósito**: una contraseña "de repuesto" en código es indistinguible de una credencial filtrada. |

---

## 2. Proveedores de datos externos — **ninguno tiene integración real**

Este es el hueco más importante y conviene decirlo sin rodeos:

> **Los nueve proveedores externos (identidad, buró, banca, telco, confianza digital, redes) no
> tienen implementación real. Ninguno.** Cada adaptador sabe hablar con el servidor de mocks y sabe
> fabricar un payload de prueba, pero ninguno sabe llamar al proveedor de verdad.

Desde la [auditoría del 2026-07-30](../audit/auditoria-integral-2026-07-30.md), eso ya no puede
pasar desapercibido:

- En `NODE_ENV=production`, un proveedor en `mock_local`/`mock_server` queda **bloqueado**
  (`PROVIDER_UNAVAILABLE` + `*_MOCK_MODE_IN_PRODUCTION`), no sirve datos inventados.
- En `production`/`sandbox`, **cada adaptador se niega por sí mismo** con
  `*_REAL_INTEGRATION_NOT_CONFIGURED`. Esa guarda no depende de que la configuración diga la verdad
  (ver más abajo, `*_REAL_INTEGRATION_IMPLEMENTED`).

Por tanto, **rellenar las credenciales de esta sección no habilita ningún proveedor**: son la
condición necesaria que abre el portón de configuración, pero falta escribir la integración.

### Credenciales por proveedor

Las exige `PRODUCTION_CREDENTIAL_REQUIREMENTS` cuando se pone `${CODE}_MODE=production`; si falta
alguna, el proceso **no arranca** (`externalProviderBootRequirements` → `assertAllProvidersConfigured`).

| Proveedor | Modo | Credenciales | Estado | Quién las provee |
|---|---|---|---|---|
| **SEGIP** (identidad, Bolivia) | `SEGIP_MODE` | `SEGIP_BASE_URL`, `SEGIP_CLIENT_ID`, `SEGIP_CLIENT_SECRET` | ⚪ | SEGIP — requiere convenio institucional |
| **INFOCENTER** (buró de crédito) | `INFOCENTER_MODE` | `INFOCENTER_BASE_URL`, `INFOCENTER_CLIENT_ID`, `INFOCENTER_CLIENT_SECRET` | ⚪ | INFOCENTER — contrato comercial |
| **QR_GENERIC** / **QR_BCB_GENERIC** (cobro QR) | `QR_GENERIC_MODE` | `QR_GENERIC_BASE_URL` | ⚪ | Banco adquirente / BCB |
| **BANKING_GENERIC** (verificación de transferencias) | `BANKING_GENERIC_MODE` | `BANKING_GENERIC_BASE_URL` | ⚪ | Banco — API de conciliación |
| **TELCO_GENERIC** (confianza del número) | `TELCO_GENERIC_MODE` | `TELCO_GENERIC_BASE_URL` | ⚪ | Operador móvil o agregador |
| **FACEBOOK_META** (señal social) | `FACEBOOK_META_MODE` | `META_FACEBOOK_APP_ID`, `META_FACEBOOK_APP_SECRET`, `META_FACEBOOK_REDIRECT_URI` | ⚪ | Meta for Developers — app revisada |
| **WHATSAPP_GENERIC** (contactabilidad) | `WHATSAPP_GENERIC_MODE` | `WHATSAPP_PROVIDER` | ⚪ | Ver la nota de abajo |
| **DIGITAL_TRUST_GENERIC** (confianza digital) | `DIGITAL_TRUST_GENERIC_MODE` | `DIGITAL_TRUST_GENERIC_BASE_URL` | ⚪ | Proveedor por definir |

**Nota sobre `WHATSAPP_PROVIDER`:** es una variable **distinta** de
`NOTIFICATION_WHATSAPP_PROVIDER`. Aquella identifica al proveedor del canal WhatsApp como *fuente de
datos de contactabilidad*; esta gobierna el *envío* de notificaciones (§3). Hoy **nada lee
`WHATSAPP_PROVIDER`** salvo la propia lista de requisitos: existe solo como llave del portón.

### La bandera que hay que tratar con cuidado

`${CODE}_REAL_INTEGRATION_IMPLEMENTED` (por defecto `false`) es lo que `productionIntegrationBlockers`
consulta para decidir si un proveedor puede operar en `production`. **Es una bandera de entorno por
sistema de honor**: nada verifica que la integración exista.

Ponerla en `true` sin haber escrito la integración era, hasta la auditoría, suficiente para que el
adaptador sirviera un payload **fabricado** etiquetado como producción — evidencia KYC inventada
persistida como features del cliente y alimentando el motor de riesgo. Ahora los ocho adaptadores se
niegan por su cuenta, así que mentirle a esa bandera ya no causa daño; la prueba que lo fija es
[`adapters-production-guard.spec.ts`](../../test/unit/external-data/adapters-production-guard.spec.ts).

`${CODE}_ALLOW_MOCK_IN_PROD` y `EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION` son el escape hatch
contrario: con `true`, producción vuelve a servir datos simulados. Solo para una demo comercial, y
con `EXTERNAL_PROVIDERS_MOCK_BASE_URL` obligatorio.

### Qué hacer mientras tanto

Dejar cada proveedor sin integración en **`${CODE}_MODE=disabled`**, no en modo simulado.
`disabled` responde un error explícito; simulado respondía un dato falso.

---

## 3. Notificaciones — todos los canales apagados por defecto

Cada canal se activa eligiendo proveedor. Con `disabled` (el valor por defecto), el canal no envía y
lo reporta; **no falla en silencio**. Las condiciones las valida `env-cross-checks.ts` al arrancar:
elegir un proveedor sin sus credenciales impide el arranque.

| Canal | Proveedor | Credenciales | Estado | Quién las provee |
|---|---|---|---|---|
| Email | `NOTIFICATION_EMAIL_PROVIDER=resend` | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | 🟠 | Resend — dominio verificado |
| Email | `=sendgrid` | `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` | 🟠 | SendGrid |
| Email | `=gmail_api` | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_FROM_EMAIL` | 🟠 | Google Cloud — OAuth con consentimiento previo |
| Push | `NOTIFICATION_PUSH_PROVIDER=fcm` | `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` | 🟠 | Firebase — cuenta de servicio (JSON) |
| SMS | `NOTIFICATION_SMS_PROVIDER=twilio` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM` | 🟠 | Twilio |
| WhatsApp | `NOTIFICATION_WHATSAPP_PROVIDER=meta_cloud` | `META_WHATSAPP_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID` | 🟠 | Meta — WhatsApp Business, plantillas aprobadas |
| WhatsApp | `=twilio` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | 🟠 | Twilio |
| Cualquiera | `=webhook` | `NOTIFICATION_WEBHOOK_URL` o la del canal (`NOTIFICATION_EMAIL_WEBHOOK_URL`, …) | 🟠 | Interno |

**Consecuencia que suele sorprender:** sin ningún canal de email configurado —ni por proveedor ni por
MailSender— el **segundo factor cae a login de un solo paso**. `isSecondFactorRequired` exige 2FA a
los actores internos, pero solo cuando existe forma real de entregar el PIN. Es fail-safe
deliberado (nadie queda fuera de su cuenta), pero significa que **en producción sin correo no hay
2FA**.

---

## 4. Servicios de plataforma

| Servicio | Variables | Estado | Qué pasa sin ellas |
|---|---|---|---|
| **MailSender** (mensajería transaccional propia) | `MAILSENDER_BASE_URL` + `MAILSENDER_EXTERNAL_API_KEY` + `MAILSENDER_ADMIN_USERNAME` + `MAILSENDER_ADMIN_PASSWORD` | 🟠 | Integración apagada. Si se configura la URL, las otras tres son **obligatorias** o no arranca. Afecta al 2FA (§3). |
| **AWS KMS** (cifrado de PII) | `KMS_KEY_ID` + `AWS_REGION` | 🟠 | La PII se cifra con una clave derivada de variable de entorno, no con un HSM. **En producción se emite un aviso ruidoso al arrancar.** Comprometer esa variable descifra toda la PII. Migración con `yarn crypto:reencrypt-pii`. |
| **Almacenamiento S3** (evidencia documental) | `STORAGE_S3_ENDPOINT`, `STORAGE_S3_BUCKET`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` | 🟠 | El endpoint de subida responde 503 y el paquete de identidad **rechaza** la evidencia, en vez de aceptar un `storageKey` que nadie puede verificar. Compatible con AWS, MinIO, R2, B2. |
| **MongoDB** (visor de logs) | `MONGO_DB_URL_CONNECTION` | 🟠 | El sync de `Archivo.log` queda apagado y `GET /systems/logs/mongo` responde `NOT_CONFIGURED`. El backend arranca igual. |
| **OpenTelemetry** | `OTEL_ENABLED=true` + `OTEL_EXPORTER_OTLP_ENDPOINT` | 🟠 | Trazas apagadas (no-op, coste cero). Las métricas Prometheus funcionan igual. |

---

## 5. Identidad del build

No son secretos, pero sin ellas `/health` no puede decir qué build está corriendo.

| Variable | Estado | Quién la provee |
|---|---|---|
| `APP_VERSION`, `APP_COMMIT_SHA`, `APP_BUILT_AT` | 🟠 | El pipeline, vía `docker build --build-arg`. Sin ellas se cae a `package.json` y `commit: null`. |

---

## 6. Resumen: para un despliegue productivo mínimo

**Imprescindible** (sin esto no arranca o no es seguro):

1. `JWT_ACCESS_TOKEN_SECRET` y `NOTIFICATION_TOKEN_ENCRYPTION_KEY` — generadas, distintas entre sí.
2. `DB_*` con el rol `atlas_app_rw`, y `DB_MIGRATION_*` con `atlas_migrator`.
3. `REDIS_URL`.
4. `DB_SSL=true` con `DB_SSL_REJECT_UNAUTHORIZED=true`.
5. `CORS_ORIGINS` / `INTERNAL_FRONTEND_ORIGIN` con los orígenes reales.

**Muy recomendable:**

6. `KMS_KEY_ID` + `AWS_REGION` — o se asume que un `.env` filtrado descifra toda la PII.
7. Un canal de email (proveedor o MailSender) — o **no hay 2FA** para los actores internos.
8. `STORAGE_S3_*` — o no se puede subir evidencia documental de KYC.
9. `APP_VERSION` / `APP_COMMIT_SHA` desde el pipeline.

**No disponible todavía, con o sin credenciales:**

10. Los nueve proveedores externos. Dejarlos en `${CODE}_MODE=disabled` hasta que exista la
    integración real. El backend opera sin ellos: onboarding, elegibilidad, crédito, riesgo
    heurístico y operaciones funcionan; lo que no hay es **evidencia externa verificada**.

## Verificación

```bash
yarn check:env-example   # el contrato de plantillas, incluidas las 14 credenciales de proveedor
yarn env:doctor          # diagnóstico del .env actual
```

Tras desplegar, `GET /external-data/providers/readiness` lista cada proveedor con sus *blockers*
concretos, y el log de arranque los enumera. Ver
[`docs/runbooks/despliegue-produccion.md`](../runbooks/despliegue-produccion.md).
