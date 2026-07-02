import 'dotenv/config';

const DEFAULT_JWT_SECRET = 'dev-only-atlas-access-token-secret-change-me';
const DEFAULT_NOTIFICATION_TOKEN_ENCRYPTION_KEY = 'change-this-32-plus-character-key-for-device-tokens';

function present(name: string): boolean {
  return typeof process.env[name] === 'string' && String(process.env[name]).trim().length > 0;
}

function mask(value: string | undefined): string {
  if (!value) return '(vacío)';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const problems: string[] = [];
const warnings: string[] = [];

if (nodeEnv === 'production') {
  if (!present('REDIS_URL')) problems.push('REDIS_URL es obligatorio en producción.');
  if (!present('JWT_ACCESS_TOKEN_SECRET')) problems.push('JWT_ACCESS_TOKEN_SECRET es obligatorio en producción.');
  if (process.env.JWT_ACCESS_TOKEN_SECRET === DEFAULT_JWT_SECRET) problems.push('JWT_ACCESS_TOKEN_SECRET no puede ser el secreto dev.');
  if (!present('NOTIFICATION_TOKEN_ENCRYPTION_KEY')) problems.push('NOTIFICATION_TOKEN_ENCRYPTION_KEY es obligatorio en producción.');
  if (process.env.NOTIFICATION_TOKEN_ENCRYPTION_KEY === DEFAULT_NOTIFICATION_TOKEN_ENCRYPTION_KEY)
    problems.push('NOTIFICATION_TOKEN_ENCRYPTION_KEY no puede ser el valor de ejemplo.');
  if (process.env.NOTIFICATION_TOKEN_ENCRYPTION_KEY === process.env.JWT_ACCESS_TOKEN_SECRET)
    problems.push('NOTIFICATION_TOKEN_ENCRYPTION_KEY debe ser distinto de JWT_ACCESS_TOKEN_SECRET.');
} else {
  if (process.env.NODE_ENV === 'production')
    warnings.push('Tu entorno global está en production. Para local usa `yarn start:dev`, que lo fuerza a development.');
  if (!present('REDIS_URL'))
    warnings.push('REDIS_URL vacío: correcto para una sola instancia local; no sirve para producción multiinstancia.');
}

console.log('ATLAS env doctor');
console.log('----------------');
console.log(`NODE_ENV=${nodeEnv}`);
console.log(`DB_HOST=${process.env.DB_HOST ?? 'localhost'}`);
console.log(`DB_NAME=${process.env.DB_NAME ?? 'atlas'}`);
console.log(`DB_USER=${process.env.DB_USER ?? 'postgres'}`);
console.log(`REDIS_URL=${mask(process.env.REDIS_URL)}`);
console.log(`JWT_ACCESS_TOKEN_SECRET=${mask(process.env.JWT_ACCESS_TOKEN_SECRET)}`);
console.log(`NOTIFICATION_TOKEN_ENCRYPTION_KEY=${mask(process.env.NOTIFICATION_TOKEN_ENCRYPTION_KEY)}`);

if (warnings.length > 0) {
  console.log('\nAdvertencias:');
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (problems.length > 0) {
  console.error('\nProblemas bloqueantes:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log('\nOK: variables mínimas coherentes para este modo.');
