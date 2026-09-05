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

  // Siembra AL ARRANCAR (opt-in). Si es true y la base está VACÍA, el backend trae el conjunto
  // sembrado publicado por la rama que indican las variables SEED_SOURCE_* (ver
  // `src/database/seed-source.ts`). Si la base ya tiene datos NO se toca nada: la carga es
  // destructiva y no debe dispararse por reiniciar un proceso. Usa la identidad de migración
  // (DB_MIGRATION_USER, cae a DB_USER), porque retirar y recrear claves foráneas es DDL.
  DATABASE_SEED_ON_STARTUP: booleanEnvSchema,
  // Si el seeding al arrancar falla y esto es true, el arranque ABORTA (exit). Por defecto false:
  // se loguea el error y el backend arranca igual (un fallo de seed no debería tumbar la API).
  DATABASE_SEED_ON_STARTUP_FAIL_FAST: booleanEnvSchema,

  // Identidad del SUPER_ADMIN de desarrollo. Ambas son opcionales y solo se leen fuera de
  // producción: sin ellas queda el correo y el hash que publica la rama de semillas, que es lo que
  // espera CI. Se aplican DESPUÉS de traer las semillas (`src/database/seed-local-identities.ts`).
  //
  // Existen porque la alternativa era peor: para que un desarrollador use su correo real —necesario
  // si quiere RECIBIR el PIN del segundo factor en una bandeja de verdad— había que reescribir el
  // email y el hash de su contraseña dentro de un archivo versionado. ATLAS-P0-002 documenta por qué
  // no: un hash que entra al historial de git se considera comprometido para siempre. Aquí la
  // contraseña vive en `.env`, que está en `.gitignore`, y se hashea en esta máquina al aplicarla.
  DEV_ADMIN_EMAIL: z.string().email().optional(),
  DEV_ADMIN_PASSWORD: z.string().optional(),

  // Contraseña de las identidades de COMERCIO de desarrollo. Opcional y sólo se lee fuera de
  // producción. Sin ella queda la que publica la rama de semillas, que por ser común a todos se
  // considera conocida: esta variable existe para que una máquina donde eso importe pueda
  // sustituirla desde `.env`, que está en `.gitignore`.
  DEV_PARTNER_PASSWORD: z.string().optional(),
} as const;
