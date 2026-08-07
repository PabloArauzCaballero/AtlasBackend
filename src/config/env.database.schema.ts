/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system declara la configuración de conexión, identidades y sembrado de PostgreSQL.
 */
import { z } from 'zod';
import { booleanEnvSchema, optionalBooleanEnvSchema } from './env.primitives.js';

/**
 * Configuración de PostgreSQL más allá de la conexión básica: pool de lectura, identidades
 * separadas por privilegio y sembrado.
 *
 * Bloque propio por el mismo criterio que `env.runtime-jobs.schema.ts`: responde a una pregunta
 * distinta del resto del entorno —"con qué identidad y contra qué conexión habla el backend con la
 * base, y qué se siembra al arrancar"— y es el bloque que consultan los scripts de migración,
 * bootstrap de roles y seeds, no el runtime HTTP. Se compone en `envBaseSchema` con un spread, así
 * que para quien lee `env.X` no cambia nada.
 *
 * `DB_HOST`/`DB_USER`/`DB_PASSWORD` y el dimensionado del pool de escritura se quedan en el esquema
 * base a propósito: son la conexión que TODO proceso necesita, incluido el que no siembra ni migra.
 */
export const databaseEnvShape = {
  /**
   * ATLAS-PERF-004 / ATLAS-SEC-012 — volcado de SQL al log.
   *
   * Antes esto no era una variable: `database.config.ts` activaba `logging: console.log` con solo
   * ver `NODE_ENV=development`. Sequelize **inlinea los valores** en la sentencia que registra, así
   * que cada `INSERT`/`SELECT` arrastraba nombre, correo, teléfono y número de documento en claro a
   * stdout — y de ahí a `Archivo.log` y al espejo en MongoDB. En un backend KYC eso es una fuga de
   * PII, y contradice la regla explícita del propio proyecto («Nunca loguear SQL», ver
   * `.claude/rules/30-security.md`). De paso invalidaba cualquier medición: 8 MB de log en una
   * corrida de 150 s.
   *
   * Ahora es una decisión explícita, apagada por defecto y PROHIBIDA en producción
   * (`env-cross-checks.ts`). Cuando se activa, el SQL pasa por el mismo redactor que el resto de los
   * logs — que reduce la exposición, no la elimina: la depuración de una query sigue siendo una
   * operación deliberada sobre datos sensibles. Ver `docs/adr/0008-logging-de-sql.md`.
   */
  DB_LOG_SQL: booleanEnvSchema,

  // Pool de LECTURA opcional (Fase 2/5 del plan de mejora del modelo de datos). La conexión
  // write/default sigue siendo DB_HOST/DB_USER/... (apúntala a atlas_app_rw). Cuando
  // DB_READ_ENABLED=true, `ReadDatabaseModule` registra una segunda conexión "read" usando estas
  // variables (apúntalas a atlas_app_ro y, en el futuro, a una réplica). Cualquier campo DB_READ_*
  // ausente cae al valor de la conexión de escritura equivalente. No usar el pool read en auth,
  // outbox, idempotencia, riesgo transaccional ni read-after-write.
  DB_READ_ENABLED: booleanEnvSchema,
  DB_READ_HOST: z.string().min(1).optional(),
  DB_READ_PORT: z.coerce.number().int().positive().optional(),
  DB_READ_NAME: z.string().min(1).optional(),
  DB_READ_USER: z.string().min(1).optional(),
  DB_READ_PASSWORD: z.string().optional(),
  DB_READ_SCHEMA: z.string().min(1).optional(),
  DB_READ_SSL: optionalBooleanEnvSchema,

  // --- Separación de identidades PostgreSQL (docs/database/postgres-roles.md) ---------------
  // DB_USER/DB_PASSWORD  = RUNTIME del backend. Debe apuntar a `atlas_app_rw` (CRUD, sin DDL).
  //
  // DB_MIGRATION_USER/PASSWORD = identidad que aplica migraciones y seeds (DDL). Si se omite, cae
  // a DB_USER — cómodo en local, pero en un entorno con roles diferenciados el runtime NO debe
  // poder alterar el schema, así que aquí se apunta a `atlas_migrator` (o al owner/admin).
  DB_MIGRATION_USER: z.string().min(1).optional(),
  DB_MIGRATION_PASSWORD: z.string().optional(),

  // DB_ADMIN_USER/PASSWORD = identidad con CREATE ROLE usada SOLO por `yarn db:roles:bootstrap`
  // para crear los roles del cluster. Si se omite, cae a DB_USER. Nunca la usa el runtime.
  DB_ADMIN_USER: z.string().min(1).optional(),
  DB_ADMIN_PASSWORD: z.string().optional(),

  // Contraseñas que `yarn db:roles:bootstrap` asigna a cada rol. No tienen default a propósito:
  // una contraseña "de repuesto" en código es indistinguible de una credencial filtrada.
  DB_APP_RW_PASSWORD: z.string().optional(),
  DB_APP_RO_PASSWORD: z.string().optional(),
  DB_MIGRATOR_PASSWORD: z.string().optional(),

  // Limpieza previa a seeds. Por defecto está apagada. En producción exige doble confirmación
  // para evitar borrar datos reales por accidente. Preserva SequelizeMeta y limpia los datos
  // de aplicación para que los seeders vuelvan a poblar un entorno consistente.
  DATABASE_CLEAN_BEFORE_SEED: booleanEnvSchema,
  DATABASE_CLEAN_ALLOW_PRODUCTION: booleanEnvSchema,
  DATABASE_CLEAN_CONFIRM: z.string().optional(),

  // Perfil de seeds a ejecutar (production | development | demo | test). Si no se define, el runner
  // lo deriva de NODE_ENV (production→production, test→test, resto→development). Ver
  // `src/database/seed-profiles.ts`. Se puede sobrescribir por comando con `--profile=...`.
  SEED_PROFILE: z.enum(['production', 'development', 'demo', 'test']).optional(),

  // Seeding idempotente AL ARRANCAR (opt-in). Si es true, el backend aplica los seeders pendientes
  // del perfil (derivado de SEED_PROFILE/NODE_ENV) al iniciar, de forma idempotente (Umzug solo
  // corre los no ejecutados). NUNCA corre seeders de dev/demo en producción: el perfil production
  // solo incluye el stage `production`. Usa la identidad de migración (DB_MIGRATION_USER, cae a
  // DB_USER en local), así que en un despliegue con roles separados requiere esa credencial.
  DATABASE_SEED_ON_STARTUP: booleanEnvSchema,
  // Si el seeding al arrancar falla y esto es true, el arranque ABORTA (exit). Por defecto false:
  // se loguea el error y el backend arranca igual (un fallo de seed no debería tumbar la API).
  DATABASE_SEED_ON_STARTUP_FAIL_FAST: booleanEnvSchema,
} as const;
