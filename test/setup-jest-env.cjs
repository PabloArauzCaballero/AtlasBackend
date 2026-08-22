// Fuerza entorno de prueba aunque Windows tenga NODE_ENV=production a nivel global.
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_TOKEN_SECRET ||= 'test-only-atlas-access-token-secret-32chars-minimum';
process.env.NOTIFICATION_TOKEN_ENCRYPTION_KEY ||= 'test-only-notification-token-key-32chars-minimum';
process.env.NOTIFICATION_EMAIL_PROVIDER ||= 'disabled';
process.env.NOTIFICATION_PUSH_PROVIDER ||= 'disabled';
process.env.NOTIFICATION_SMS_PROVIDER ||= 'disabled';
process.env.NOTIFICATION_WHATSAPP_PROVIDER ||= 'disabled';
process.env.NOTIFICATION_PHONE_PROVIDER ||= 'disabled';
process.env.DB_NAME ||= 'atlas_test';
process.env.SYSTEM_TEST_ALLOWED_HOSTS_STAGING ||= 'staging.atlas.example.com';
process.env.SYSTEM_TEST_ALLOWED_HOSTS_PRODUCTION_READONLY ||= 'production.atlas.example.com';
// Ningún test debe disparar el setInterval real de SystemsHealthMonitorService.
process.env.SYSTEM_HEALTH_MONITOR_ENABLED ||= 'false';

// --- Aislamiento del `.env` del desarrollador ----------------------------------------------------
// `src/config/env.ts` carga `.env` con dotenv, que NO pisa variables ya definidas. Este archivo se
// ejecuta antes, así que lo que se fije aquí gana. Lo que faltaba era justamente esto: las claves
// que `.env.example` trae VACÍAS (y que por tanto un `.env` copiado del ejemplo también trae vacías)
// no estaban cubiertas, y Zod las rechazaba. Resultado: crear un `.env` local —algo perfectamente
// normal para levantar el stack— tumbaba 242 suites con un error que no menciona el `.env` por
// ningún lado. La suite no debe depender de la configuración local de quien la ejecuta.
process.env.DB_READ_HOST ||= 'localhost';
process.env.DB_READ_PORT ||= '5432';
process.env.DB_READ_NAME ||= 'atlas_test';
process.env.DB_READ_USER ||= 'atlas_test';
process.env.DB_READ_SCHEMA ||= 'public';
process.env.SEED_PROFILE ||= 'test';
process.env.DEV_ADMIN_EMAIL ||= 'dev.admin@atlas.test';
process.env.DECISION_ENGINE_ENVIRONMENT_CODE ||= 'TEST';
process.env.KMS_KEY_ID ||= 'test-only-kms-key-id';
process.env.AWS_REGION ||= 'us-east-1';
