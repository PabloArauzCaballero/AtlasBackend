import { describe, expect, it } from '@jest/globals';
import { applyEnvCrossChecks } from '../../../src/config/env-cross-checks.js';
import { DEFAULT_JWT_SECRET, DEFAULT_NOTIFICATION_TOKEN_ENCRYPTION_KEY, envBaseSchema } from '../../../src/config/env.schema.js';

/**
 * `applyEnvCrossChecks` es la función que decide si una configuración puede desplegarse: es la que
 * rechaza secretos de ejemplo en producción, un canal de notificación sin credenciales o un worker
 * con el planificador apagado. **No tenía ninguna prueba.**
 *
 * Eso es un hueco de verdad: cada validación de aquí existe porque su ausencia produce un fallo
 * SILENCIOSO (un proceso que arranca sano y no hace nada, un canal que dice estar activo y no envía,
 * un `.env` filtrado que descifra toda la PII). Sin pruebas, quitar una por accidente no rompe nada
 * visible — hasta el despliegue.
 *
 * Se ejercita a través del esquema completo (`envBaseSchema.superRefine`) y no llamando a la función
 * suelta, porque así se prueba el mismo camino que corre al arrancar: `parseEnv` compone justamente
 * estas dos piezas.
 */
describe('applyEnvCrossChecks', () => {
  const schema = envBaseSchema.superRefine(applyEnvCrossChecks);

  /** Configuración productiva MÍNIMA y válida. Cada prueba parte de aquí y rompe una sola cosa. */
  const validProduction = {
    NODE_ENV: 'production',
    JWT_ACCESS_TOKEN_SECRET: 'un-secreto-de-produccion-suficientemente-largo',
    NOTIFICATION_TOKEN_ENCRYPTION_KEY: 'otra-clave-distinta-y-tambien-larga-de-verdad',
    REDIS_URL: 'redis://cache:6379',
  } as Record<string, unknown>;

  /** Códigos de error de las validaciones cruzadas, por la ruta (nombre de variable) que señalan. */
  const failedPaths = (input: Record<string, unknown>): string[] => {
    const result = schema.safeParse(input);
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
  };

  it('una configuración productiva mínima y coherente es válida', () => {
    expect(failedPaths(validProduction)).toEqual([]);
  });

  describe('secretos', () => {
    it('rechaza el secreto JWT de ejemplo en producción', () => {
      expect(failedPaths({ ...validProduction, JWT_ACCESS_TOKEN_SECRET: DEFAULT_JWT_SECRET })).toContain('JWT_ACCESS_TOKEN_SECRET');
    });

    it('rechaza la clave de cifrado de tokens de ejemplo en producción', () => {
      expect(failedPaths({ ...validProduction, NOTIFICATION_TOKEN_ENCRYPTION_KEY: DEFAULT_NOTIFICATION_TOKEN_ENCRYPTION_KEY })).toContain(
        'NOTIFICATION_TOKEN_ENCRYPTION_KEY',
      );
    });

    it('rechaza reutilizar el secreto JWT como clave de cifrado: comprometer uno comprometería ambos', () => {
      const reused = 'la-misma-clave-para-las-dos-cosas-no-vale';
      expect(failedPaths({ ...validProduction, JWT_ACCESS_TOKEN_SECRET: reused, NOTIFICATION_TOKEN_ENCRYPTION_KEY: reused })).toContain(
        'NOTIFICATION_TOKEN_ENCRYPTION_KEY',
      );
    });

    it('fuera de producción los valores de ejemplo son legítimos', () => {
      const development = {
        NODE_ENV: 'development',
        JWT_ACCESS_TOKEN_SECRET: DEFAULT_JWT_SECRET,
        NOTIFICATION_TOKEN_ENCRYPTION_KEY: DEFAULT_NOTIFICATION_TOKEN_ENCRYPTION_KEY,
      };
      expect(failedPaths(development)).toEqual([]);
    });
  });

  describe('infraestructura', () => {
    it('exige REDIS_URL en producción: sin él el rate limiting sólo protege por instancia', () => {
      const { REDIS_URL: _omitted, ...withoutRedis } = validProduction;
      expect(failedPaths(withoutRedis)).toContain('REDIS_URL');
    });

    it('con TLS activo, no permite desactivar la validación del certificado de PostgreSQL', () => {
      expect(failedPaths({ ...validProduction, DB_SSL: 'true', DB_SSL_REJECT_UNAUTHORIZED: 'false' })).toContain(
        'DB_SSL_REJECT_UNAUTHORIZED',
      );
    });

    it('sin TLS, la validación del certificado es irrelevante y no se exige', () => {
      expect(failedPaths({ ...validProduction, DB_SSL: 'false', DB_SSL_REJECT_UNAUTHORIZED: 'false' })).toEqual([]);
    });
  });

  /**
   * Las dos combinaciones prohibidas no "funcionan a medias": fallan en silencio, que es peor. Un
   * worker con el planificador apagado arranca, se declara sano y no ejecuta absolutamente nada.
   */
  describe('rol del proceso frente al planificador', () => {
    it('un worker sin planificador sería un proceso que arranca sano y no hace nada', () => {
      expect(failedPaths({ ...validProduction, APP_ROLE: 'worker', RUNTIME_JOBS_SCHEDULER_ENABLED: 'false' })).toContain(
        'RUNTIME_JOBS_SCHEDULER_ENABLED',
      );
    });

    it('una API con planificador haría creer que los jobs corren cuando el rol los desactiva', () => {
      expect(failedPaths({ ...validProduction, APP_ROLE: 'api', RUNTIME_JOBS_SCHEDULER_ENABLED: 'true' })).toContain(
        'RUNTIME_JOBS_SCHEDULER_ENABLED',
      );
    });

    it('acepta las combinaciones coherentes de cada rol', () => {
      expect(failedPaths({ ...validProduction, APP_ROLE: 'worker', RUNTIME_JOBS_SCHEDULER_ENABLED: 'true' })).toEqual([]);
      expect(failedPaths({ ...validProduction, APP_ROLE: 'api', RUNTIME_JOBS_SCHEDULER_ENABLED: 'false' })).toEqual([]);
      expect(failedPaths({ ...validProduction, APP_ROLE: 'all', RUNTIME_JOBS_SCHEDULER_ENABLED: 'true' })).toEqual([]);
    });
  });

  describe('escape hatch de datos simulados en producción', () => {
    it('activarlo sin servidor de mocks es querer datos simulados sin haberlos configurado', () => {
      expect(failedPaths({ ...validProduction, EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION: 'true' })).toContain(
        'EXTERNAL_PROVIDERS_MOCK_BASE_URL',
      );
    });

    it('con el servidor de mocks declarado, la decisión es consciente y se acepta', () => {
      expect(
        failedPaths({
          ...validProduction,
          EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION: 'true',
          EXTERNAL_PROVIDERS_MOCK_BASE_URL: 'https://mocks.interno',
        }),
      ).toEqual([]);
    });

    it('con el flag apagado (el default) no se exige nada', () => {
      expect(failedPaths({ ...validProduction, EXTERNAL_PROVIDERS_ALLOW_MOCK_IN_PRODUCTION: 'false' })).toEqual([]);
    });
  });

  describe('MailSender', () => {
    it('configurar la URL sin credenciales deja una integración a medias', () => {
      const paths = failedPaths({ ...validProduction, MAILSENDER_BASE_URL: 'https://mail.interno' });
      expect(paths).toEqual(
        expect.arrayContaining(['MAILSENDER_EXTERNAL_API_KEY', 'MAILSENDER_ADMIN_USERNAME', 'MAILSENDER_ADMIN_PASSWORD']),
      );
    });

    it('sin URL, la integración está apagada y no se exige nada', () => {
      expect(failedPaths(validProduction)).toEqual([]);
    });
  });

  /**
   * Un canal con proveedor elegido pero sin credenciales es el peor estado posible: el sistema cree
   * que puede enviar y falla en cada intento, en vez de decir de entrada que está apagado.
   */
  describe('proveedores de notificación', () => {
    it.each([
      ['resend', 'NOTIFICATION_EMAIL_PROVIDER', ['RESEND_API_KEY', 'RESEND_FROM_EMAIL']],
      ['sendgrid', 'NOTIFICATION_EMAIL_PROVIDER', ['SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL']],
      ['gmail_api', 'NOTIFICATION_EMAIL_PROVIDER', ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'GMAIL_FROM_EMAIL']],
      ['fcm', 'NOTIFICATION_PUSH_PROVIDER', ['FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY']],
      ['twilio', 'NOTIFICATION_SMS_PROVIDER', ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_SMS_FROM']],
      ['meta_cloud', 'NOTIFICATION_WHATSAPP_PROVIDER', ['META_WHATSAPP_TOKEN', 'META_WHATSAPP_PHONE_NUMBER_ID']],
    ])('%s exige sus credenciales', (provider, variable, required) => {
      const paths = failedPaths({ ...validProduction, [variable]: provider });
      expect(paths).toEqual(expect.arrayContaining(required));
    });

    it('WhatsApp por Twilio comparte las credenciales de cuenta pero exige su propio remitente', () => {
      const paths = failedPaths({ ...validProduction, NOTIFICATION_WHATSAPP_PROVIDER: 'twilio' });
      expect(paths).toEqual(expect.arrayContaining(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM']));
      expect(paths).not.toContain('TWILIO_SMS_FROM');
    });

    it('todos en disabled (el default) es una configuración válida: los canales están apagados, no rotos', () => {
      expect(failedPaths(validProduction)).toEqual([]);
    });

    it.each([
      ['NOTIFICATION_EMAIL_PROVIDER', 'NOTIFICATION_EMAIL_WEBHOOK_URL'],
      ['NOTIFICATION_PUSH_PROVIDER', 'NOTIFICATION_PUSH_WEBHOOK_URL'],
      ['NOTIFICATION_SMS_PROVIDER', 'NOTIFICATION_SMS_WEBHOOK_URL'],
      ['NOTIFICATION_WHATSAPP_PROVIDER', 'NOTIFICATION_WHATSAPP_WEBHOOK_URL'],
      ['NOTIFICATION_PHONE_PROVIDER', 'NOTIFICATION_PHONE_WEBHOOK_URL'],
    ])('%s=webhook exige una URL, propia o compartida', (variable, channelUrl) => {
      expect(failedPaths({ ...validProduction, [variable]: 'webhook' })).toContain(channelUrl);
      expect(failedPaths({ ...validProduction, [variable]: 'webhook', NOTIFICATION_WEBHOOK_URL: 'https://hooks/x' })).toEqual([]);
      expect(failedPaths({ ...validProduction, [variable]: 'webhook', [channelUrl]: 'https://hooks/y' })).toEqual([]);
    });
  });

  it('los mensajes de error nombran la variable y explican la consecuencia, no sólo "inválido"', () => {
    const result = schema.safeParse({ ...validProduction, APP_ROLE: 'worker', RUNTIME_JOBS_SCHEDULER_ENABLED: 'false' });
    const message = result.success ? '' : result.error.issues.map((issue) => issue.message).join('\n');
    expect(message).toContain('RUNTIME_JOBS_SCHEDULER_ENABLED');
    expect(message).toContain('no ejecuta ningún trabajo de fondo');
  });
});
