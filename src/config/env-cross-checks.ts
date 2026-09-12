/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida y compone configuración tipada al arrancar.
 */
import { z } from 'zod';
import { DEFAULT_JWT_SECRET, DEFAULT_NOTIFICATION_TOKEN_ENCRYPTION_KEY, type RawAppEnv } from './env.schema.js';
import { checkNotificationProviders, type RequireWebhook, type RequireWhen } from './env.notification-providers.checks.js';
import { checkFileStorage } from './env.files.checks.js';
import { checkDecisionEngine } from './env.decision-engine.checks.js';
import { checkInternalSecondFactor, checkPiiEncryptionProvider, checkSqlLogging } from './env.security.checks.js';

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
/**
 * Buzones de correo gratuitos. Sirven para desarrollar y no para escribirle a un cliente.
 *
 * No es una cuestion de imagen: un correo que pide teclear un codigo y llega desde una cuenta
 * personal es indistinguible de un intento de suplantacion, y le estamos ENSEÑANDO al cliente a
 * fiarse de ese remitente. Ademas, un dominio propio es lo unico que permite firmar con SPF, DKIM y
 * DMARC; sin eso el correo acaba en spam justo cuando mas urge —el codigo que caduca en diez
 * minutos—.
 */
const DOMINIOS_DE_CORREO_PERSONAL = [
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
];

/** Los buzones de estudiante y similares tampoco: son cuentas personales con otro nombre. */
function esBuzonPersonal(email: string): boolean {
  const dominio = email.trim().toLowerCase().split('@')[1] ?? '';
  if (!dominio) return false;
  return DOMINIOS_DE_CORREO_PERSONAL.includes(dominio) || dominio.includes('estudiantes.') || dominio.includes('alumnos.');
}

function checkSecrets(data: RawAppEnv, ctx: z.RefinementCtx): void {
  // El worker de Mensajería (perfil `messaging`) no verifica sesiones de usuario: no necesita ese secreto.
  if (
    data.NODE_ENV === 'production' &&
    data.ATLAS_CAPABILITY_PROFILE !== 'messaging' &&
    data.JWT_ACCESS_TOKEN_SECRET === DEFAULT_JWT_SECRET
  ) {
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
    if (data.GMAIL_FROM_EMAIL && esBuzonPersonal(data.GMAIL_FROM_EMAIL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GMAIL_FROM_EMAIL'],
        message:
          'GMAIL_FROM_EMAIL no puede ser una cuenta personal en producción: el correo que pide un código de ' +
          'verificación tiene que salir de un buzón de la plataforma, con dominio propio.',
      });
    }
  }
}

/** Dependencias de infraestructura sin las cuales producción no es segura. */
function checkInfrastructure(data: RawAppEnv, ctx: z.RefinementCtx): void {
  // El perfil `messaging` no sirve HTTP público (sin rate limiting) y coordina por `context_ownership`, no por Redis.
  if (data.NODE_ENV === 'production' && data.ATLAS_CAPABILITY_PROFILE !== 'messaging' && !data.REDIS_URL) {
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
function checkContextServiceTransport(data: RawAppEnv, ctx: z.RefinementCtx): void {
  // Revisión independiente A, hallazgo 10: por esa URL viajan el Bearer de servicio y los contactos
  // descifrados. En producción sólo se admite http:// hacia la red interna (nombre de servicio sin punto).
  if (data.NODE_ENV !== 'production' || !data.CUSTOMERS_DIRECTORY_URL) return;
  const url = new URL(data.CUSTOMERS_DIRECTORY_URL);
  const internalHost = !url.hostname.includes('.') || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !internalHost) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CUSTOMERS_DIRECTORY_URL'],
      message:
        'CUSTOMERS_DIRECTORY_URL debe ser https:// en producción salvo que apunte a un host de la red interna: ' +
        'por ese canal viajan el token de servicio y las direcciones de contacto en claro.',
    });
  }
}

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
  // El perfil `messaging` relaja requisitos de producción: sólo puede correrlo un worker, nunca la API.
  // Revisión independiente A, hallazgo 2: sin identidad propia el worker caería a DB_USER (atlas_app_rw),
  // que sí lee Crédito y Clientes; toda la frontera de privilegios del piloto se evaporaría en silencio.
  if (data.ATLAS_CAPABILITY_PROFILE === 'messaging' && !data.MESSAGING_DB_USER) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MESSAGING_DB_USER'],
      message:
        'ATLAS_CAPABILITY_PROFILE=messaging exige MESSAGING_DB_USER (el rol por contexto atlas_ctx_messaging). ' +
        'Sin él el proceso arrancaría con la identidad del monolito, que sí puede leer Crédito y Clientes.',
    });
  }
  if (data.ATLAS_CAPABILITY_PROFILE === 'messaging' && data.APP_ROLE !== 'worker') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ATLAS_CAPABILITY_PROFILE'],
      message:
        'ATLAS_CAPABILITY_PROFILE=messaging exige APP_ROLE=worker: la API no puede arrancar con los requisitos relajados del piloto.',
    });
  }
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
  checkContextServiceTransport(data, ctx);
  checkSimulatedDataEscapeHatch(data, ctx);
  checkProcessRole(data, ctx);
  checkInternalSecondFactor(data, ctx);
  checkPiiEncryptionProvider(data, ctx);
  checkSqlLogging(data, ctx);
  checkFileStorage(data, ctx);
  checkMailSender(data, requireWhen);
  checkDecisionEngine(data, ctx);
  checkNotificationProviders(data, requireWhen, requireWebhook);
}
