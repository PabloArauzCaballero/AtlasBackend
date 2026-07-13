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
