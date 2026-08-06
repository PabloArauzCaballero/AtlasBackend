/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida y compone configuración tipada al arrancar.
 */
import { z } from 'zod';
import { DEFAULT_JWT_SECRET, DEFAULT_NOTIFICATION_TOKEN_ENCRYPTION_KEY, type RawAppEnv } from './env.schema.js';
import { checkNotificationProviders, type RequireWebhook, type RequireWhen } from './env.notification-providers.checks.js';

/**
 * Validaciones CRUZADAS del entorno: las que dependen de más de una variable a la vez y por eso no
 * caben en el esquema por campo (un provider que exige sus credenciales, producción que prohíbe los
 * secretos de ejemplo, un canal 'webhook' que necesita URL).
 *
 * Vive fuera de `env.schema.ts` porque son dos responsabilidades distintas: aquella declara QUÉ
 * variables existen y su forma; esta declara qué combinaciones son inválidas.
 */

/**
 * Secretos que no pueden ser los de ejemplo en producción, ni compartirse entre sí: comprometer uno
 * comprometería ambos usos.
 */
function checkSecrets(data: RawAppEnv, ctx: z.RefinementCtx): void {
  if (data.NODE_ENV === 'production' && data.JWT_ACCESS_TOKEN_SECRET === DEFAULT_JWT_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_ACCESS_TOKEN_SECRET'],
      message: 'JWT_ACCESS_TOKEN_SECRET no puede ser el valor por defecto en producción. Configura una clave secreta segura.',
    });
  }

  if (data.NODE_ENV === 'production') {
    if (data.NOTIFICATION_TOKEN_ENCRYPTION_KEY === DEFAULT_NOTIFICATION_TOKEN_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NOTIFICATION_TOKEN_ENCRYPTION_KEY'],
        message: 'NOTIFICATION_TOKEN_ENCRYPTION_KEY no puede ser el valor de ejemplo en producción.',
      });
    }
    if (data.NOTIFICATION_TOKEN_ENCRYPTION_KEY === data.JWT_ACCESS_TOKEN_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NOTIFICATION_TOKEN_ENCRYPTION_KEY'],
        message: 'NOTIFICATION_TOKEN_ENCRYPTION_KEY debe ser distinto de JWT_ACCESS_TOKEN_SECRET en producción.',
      });
    }
  }
}

/** Dependencias de infraestructura sin las cuales producción no es segura. */
function checkInfrastructure(data: RawAppEnv, ctx: z.RefinementCtx): void {
  if (data.NODE_ENV === 'production' && !data.REDIS_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['REDIS_URL'],
      message: 'REDIS_URL es requerido en producción: sin Redis, el rate limiting solo protege por instancia.',
    });
  }

  if (data.NODE_ENV === 'production' && data.DB_SSL && !data.DB_SSL_REJECT_UNAUTHORIZED) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DB_SSL_REJECT_UNAUTHORIZED'],
      message: 'DB_SSL_REJECT_UNAUTHORIZED debe permanecer activo en produccion para validar el certificado PostgreSQL.',
    });
  }
}

/** Escape hatch de datos simulados en producción (hallazgo A-02). */
function checkSimulatedDataEscapeHatch(data: RawAppEnv, ctx: z.RefinementCtx): void {
  // Hallazgo A-02: activar el escape hatch de mocks en producción es una decisión legítima solo para
  // una demo comercial, y entonces el servidor de mocks tiene que existir. Sin URL, cada proveedor en
  // `mock_server` fallaría con MOCK_BASE_URL_NOT_CONFIGURED y `mock_local` serviría datos inventados
  // desde el propio proceso: exactamente lo que el escape hatch pretende permitir a conciencia, pero
  // sin que nadie lo haya configurado a conciencia.
  if (data.NODE_ENV === 'production' && data.EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION && !data.EXTERNAL_PROVIDERS_MOCK_BASE_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['EXTERNAL_PROVIDERS_MOCK_BASE_URL'],
      message:
        'EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION=true exige EXTERNAL_PROVIDERS_MOCK_BASE_URL. ' +
        'Si no querías servir datos simulados en producción, deja el flag en false.',
    });
  }
}

/** Coherencia entre el rol del proceso y el planificador de trabajos de fondo. */
function checkProcessRole(data: RawAppEnv, ctx: z.RefinementCtx): void {
  // Rol del proceso contra planificador. Las dos combinaciones de abajo no "funcionan a medias":
  // fallan en silencio, que es peor. Un worker con el planificador apagado arranca, se declara sano
  // y no ejecuta absolutamente nada; una API con el planificador encendido hace creer que los jobs
  // corren cuando el gate de rol los desactiva. Ver docs/architecture/background-processing.md.
  if (data.APP_ROLE === 'worker' && !data.RUNTIME_JOBS_SCHEDULER_ENABLED) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['RUNTIME_JOBS_SCHEDULER_ENABLED'],
      message:
        'APP_ROLE=worker exige RUNTIME_JOBS_SCHEDULER_ENABLED=true: un worker con el planificador apagado ' +
        'arranca sano y no ejecuta ningún trabajo de fondo.',
    });
  }

  if (data.APP_ROLE === 'api' && data.RUNTIME_JOBS_SCHEDULER_ENABLED) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['RUNTIME_JOBS_SCHEDULER_ENABLED'],
      message:
        'APP_ROLE=api no ejecuta trabajos de fondo, así que RUNTIME_JOBS_SCHEDULER_ENABLED=true no tendría efecto. ' +
        'Usa APP_ROLE=all para un despliegue de una sola pieza, o mueve el planificador a un proceso APP_ROLE=worker.',
    });
  }
}

/**
 * ATLAS-SEC-008 — el segundo factor de los actores internos no puede desaparecer en silencio.
 *
 * `AuthService.isSecondFactorRequired` degrada a "sin 2FA" cuando MailSender no está configurado:
 * sin canal no hay forma de entregar el PIN, y bloquear el login dejaría el backend inaccesible en
 * un entorno local. Esa degradación es correcta en desarrollo y **inaceptable en producción**: un
 * despliegue con `MAILSENDER_BASE_URL` vacío dejaba a `admin` y `platform_admin` entrando con solo
 * la contraseña, sin error ni advertencia (verificado en vivo:
 * docs/audit/evidence/live-exploit-2026-08-06.md).
 *
 * Se falla al arrancar en vez de advertir: una advertencia sobre un control de seguridad ausente es
 * un control ausente. Si un despliegue quiere de verdad renunciar al 2FA interno, tiene que
 * escribirlo (`AUTH_LOGIN_PIN_ENABLED=false`) y aun así se le exige un canal de correo, porque el
 * mismo canal entrega el reset de contraseña.
 */
function checkInternalSecondFactor(data: RawAppEnv, ctx: z.RefinementCtx): void {
  if (data.NODE_ENV !== 'production') return;

  if (!data.MAILSENDER_BASE_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MAILSENDER_BASE_URL'],
      message:
        'MAILSENDER_BASE_URL es requerido en producción: es el canal que entrega el PIN de segundo factor de los actores ' +
        'internos y los códigos de recuperación de contraseña. Sin él, el login de admin/platform_admin degrada a un solo factor.',
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
function checkPiiEncryptionProvider(data: RawAppEnv, ctx: z.RefinementCtx): void {
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
function checkSqlLogging(data: RawAppEnv, ctx: z.RefinementCtx): void {
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

/** MailSender: configurar la URL obliga a configurar sus credenciales. */
function checkMailSender(data: RawAppEnv, requireWhen: RequireWhen): void {
  requireWhen(
    Boolean(data.MAILSENDER_BASE_URL),
    'MAILSENDER_EXTERNAL_API_KEY',
    'MAILSENDER_EXTERNAL_API_KEY es requerido cuando MAILSENDER_BASE_URL está configurado.',
  );
  requireWhen(
    Boolean(data.MAILSENDER_BASE_URL),
    'MAILSENDER_ADMIN_USERNAME',
    'MAILSENDER_ADMIN_USERNAME es requerido cuando MAILSENDER_BASE_URL está configurado.',
  );
  requireWhen(
    Boolean(data.MAILSENDER_BASE_URL),
    'MAILSENDER_ADMIN_PASSWORD',
    'MAILSENDER_ADMIN_PASSWORD es requerido cuando MAILSENDER_BASE_URL está configurado.',
  );
}

/**
 * Validaciones CRUZADAS del entorno: las que dependen de más de una variable a la vez y por eso no
 * caben en el esquema por campo.
 *
 * El cuerpo es deliberadamente una LISTA de qué se valida: cada bloque vive en su propia función, de
 * modo que añadir una integración nueva no siga engordando una sola función de 187 líneas (que es lo
 * que era antes de dividirla). Las 30 pruebas de `test/unit/config/env-cross-checks.spec.ts` fijan el
 * comportamiento de cada bloque.
 */
export function applyEnvCrossChecks(data: RawAppEnv, ctx: z.RefinementCtx): void {
  const requireWhen: RequireWhen = (enabled, path, message) => {
    const value = data[path];
    if (enabled && (typeof value !== 'string' || value.trim().length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    }
  };

  const requireWebhook: RequireWebhook = (channelProvider, channelUrl, channelName) => {
    const channelSpecificUrl = data[channelUrl];
    if (channelProvider === 'webhook' && !channelSpecificUrl && !data.NOTIFICATION_WEBHOOK_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [channelUrl],
        message: `${channelName} usa provider webhook. Configura ${String(channelUrl)} o NOTIFICATION_WEBHOOK_URL.`,
      });
    }
  };

  checkSecrets(data, ctx);
  checkInfrastructure(data, ctx);
  checkSimulatedDataEscapeHatch(data, ctx);
  checkProcessRole(data, ctx);
  checkInternalSecondFactor(data, ctx);
  checkPiiEncryptionProvider(data, ctx);
  checkSqlLogging(data, ctx);
  checkMailSender(data, requireWhen);
  checkNotificationProviders(data, requireWhen, requireWebhook);
}
