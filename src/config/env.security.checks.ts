/**
 * @file Comprobaciones cruzadas del entorno que protegen el ACCESO y el dato sensible.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida y compone configuración tipada al arrancar.
 */
import { z } from 'zod';
import type { RawAppEnv } from './env.schema.js';

/**
 * Salen de `env-cross-checks.ts` porque ese archivo pasaba de las 300 líneas que admite
 * `check:file-size`, y porque las tres comparten sujeto: quién entra (el segundo factor interno) y
 * qué se puede leer del dato del cliente (el proveedor de cifrado de PII y el registro de SQL). Las
 * demás comprobaciones cruzadas son de integraciones y siguen allí.
 */

/**
 * ATLAS-SEC-008 — el segundo factor de los actores internos no puede desaparecer en silencio.
 *
 * `AuthSecondFactorService.isRequired` degrada a "sin 2FA" cuando no hay canal de correo: sin canal
 * no hay forma de entregar el PIN, y bloquear el login dejaría el backend inaccesible en un entorno
 * local. Esa degradación es correcta en desarrollo y **inaceptable en producción**: un despliegue
 * sin canal dejaba a `admin` y `platform_admin` entrando con solo la contraseña, sin error ni
 * advertencia (verificado en vivo: docs/audit/evidence/live-exploit-2026-08-06.md).
 *
 * Se falla al arrancar en vez de advertir: una advertencia sobre un control de seguridad ausente es
 * un control ausente. Si un despliegue quiere de verdad renunciar al 2FA interno, tiene que
 * escribirlo (`AUTH_LOGIN_PIN_ENABLED=false`) y aun así se le exige un canal de correo, porque el
 * mismo canal entrega el reset de contraseña.
 *
 * Lo que se exige es UN CANAL, no un proveedor concreto. Antes se pedía `MAILSENDER_BASE_URL` en
 * particular, y eso confundía el control con su implementación: un despliegue con la Gmail API
 * elegida y credenciales válidas —capaz de entregar el PIN, y con `MailSenderService` sabiendo
 * usarla— no arrancaba, empujando a apagar la comprobación por una razón que no era de seguridad.
 */
export function checkInternalSecondFactor(data: RawAppEnv, ctx: z.RefinementCtx): void {
  if (data.NODE_ENV !== 'production') return;

  const gmailReady = Boolean(
    data.NOTIFICATION_EMAIL_PROVIDER === 'gmail_api' &&
    data.GMAIL_CLIENT_ID &&
    data.GMAIL_CLIENT_SECRET &&
    data.GMAIL_REFRESH_TOKEN &&
    data.GMAIL_FROM_EMAIL,
  );

  /*
   * El MISMO criterio que `MailSenderClient.isConfigured()` aplica en caliente.
   *
   * Antes aquí bastaba `MAILSENDER_BASE_URL` y en runtime se exigían además la API key y las dos
   * credenciales admin. Un despliegue en esa franja —la URL puesta, el resto no— arrancaba sin una
   * queja y luego se comportaba como si no hubiera canal: los actores internos recibían 503 en cada
   * login y quien tuviera MFA opt-in entraba con un solo factor. Dos definiciones de «hay canal»
   * que no coincidían, y la que decidía era la que nadie miraba al desplegar.
   */
  const mailSenderReady = Boolean(
    data.MAILSENDER_BASE_URL && data.MAILSENDER_EXTERNAL_API_KEY && data.MAILSENDER_ADMIN_USERNAME && data.MAILSENDER_ADMIN_PASSWORD,
  );

  if (!mailSenderReady && !gmailReady) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MAILSENDER_BASE_URL'],
      message:
        'Producción necesita un canal de correo COMPLETO: es el que entrega el PIN de segundo factor de los actores ' +
        'internos y los códigos de recuperación de contraseña. Configura MAILSENDER_BASE_URL junto con ' +
        'MAILSENDER_EXTERNAL_API_KEY, MAILSENDER_ADMIN_USERNAME y MAILSENDER_ADMIN_PASSWORD (las cuatro: con menos, el ' +
        'cliente de correo se considera no configurado en caliente y el canal no existe), o ' +
        'NOTIFICATION_EMAIL_PROVIDER=gmail_api con sus cuatro credenciales. Sin ninguno, el login de admin/platform_admin ' +
        'degrada a un solo factor.',
    });
  }

  if (!data.AUTH_LOGIN_PIN_ENABLED) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['AUTH_LOGIN_PIN_ENABLED'],
      message:
        'AUTH_LOGIN_PIN_ENABLED=false deja a los usuarios internos (admin, platform_admin) con un solo factor. ' +
        'No es una configuración admisible en producción.',
    });
  }
}

/**
 * ATLAS-SEC-011 — cifrado de PII en producción sin KMS.
 *
 * Antes esto era un `console.warn` en `env.ts`: producción arrancaba con la master key de toda la
 * PII derivada de una variable de entorno y el aviso se perdía entre las líneas de arranque. Un
 * control de seguridad cuya ausencia se comunica por consola es un control ausente.
 *
 * No se prohíbe el despliegue sin KMS —es legítimo en la etapa actual del producto— pero sí se exige
 * declararlo: `PII_ENCRYPTION_ALLOW_ENV_MASTER_KEY=true`. Así el riesgo queda firmado en el
 * manifiesto de despliegue, revisable en un PR, en vez de asumido por omisión.
 */
export function checkPiiEncryptionProvider(data: RawAppEnv, ctx: z.RefinementCtx): void {
  if (data.NODE_ENV !== 'production') return;
  if (data.KMS_KEY_ID && data.AWS_REGION) return;
  if (data.PII_ENCRYPTION_ALLOW_ENV_MASTER_KEY) return;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['KMS_KEY_ID'],
    message:
      'Producción sin KMS_KEY_ID + AWS_REGION: la master key de TODA la PII se derivaría de una variable de entorno, ' +
      'y comprometerla descifra el histórico completo. Configura KMS (y migra con `yarn crypto:reencrypt-pii`), o ' +
      'declara el riesgo explícitamente con PII_ENCRYPTION_ALLOW_ENV_MASTER_KEY=true.',
  });
}

/**
 * ATLAS-SEC-012 — el volcado de SQL no se activa en producción.
 *
 * Sequelize inlinea los valores en la sentencia que registra, así que `DB_LOG_SQL=true` publica en
 * claro todo lo que pasa por la base: en un backend KYC, nombre, correo, teléfono y número de
 * documento. `redactSensitiveText` enmascara lo que puede reconocer por clave, pero un valor
 * posicional sin nombre no es reconocible — la redacción reduce el daño, no lo elimina.
 *
 * Depurar una consulta es una operación legítima en local; en producción es una fuga. Sin válvula de
 * escape a propósito: si hiciera falta ver SQL en producción, el camino correcto es `pg_stat_statements`
 * (que normaliza los literales) o el log del propio servidor, no el pipeline de logs de la aplicación.
 */
export function checkSqlLogging(data: RawAppEnv, ctx: z.RefinementCtx): void {
  if (data.NODE_ENV === 'production' && data.DB_LOG_SQL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DB_LOG_SQL'],
      message:
        'DB_LOG_SQL=true vuelca cada sentencia con sus valores inlineados al pipeline de logs: en producción eso es PII ' +
        'en claro (nombre, correo, teléfono, documento). Usa pg_stat_statements, que normaliza los literales.',
    });
  }
}
