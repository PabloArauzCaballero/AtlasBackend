/**
 * @file Guarda de aislamiento de la base de pruebas de integración (AT-002).
 * @business Una suite que escribe, revierte y provoca carreras no puede apuntar por descuido a la
 *   base de desarrollo ni, peor, a una productiva. `NODE_ENV=test` no lo garantiza: lo fija el
 *   propio corredor de pruebas.
 * @system Función pura sobre las variables de entorno: exige la bandera explícita
 *   `ATLAS_TEST_DATABASE_ISOLATED=true` y que la base se identifique como de prueba por su nombre
 *   (`*test*`) o por haber sido autorizada nominalmente en `ATLAS_TEST_DATABASE_NAME`.
 */

export type IsolationEnv = Partial<Record<'ATLAS_TEST_DATABASE_ISOLATED' | 'ATLAS_TEST_DATABASE_NAME' | 'DB_NAME' | 'NODE_ENV', string>>;

export type IsolationVerdict = { allowed: true; database: string } | { allowed: false; reason: string };

export const ISOLATION_FLAG = 'ATLAS_TEST_DATABASE_ISOLATED';
export const AUTHORIZED_NAME = 'ATLAS_TEST_DATABASE_NAME';

/** Nombres que nunca se aceptan aunque alguien los autorice: son las bases reales de la plataforma. */
const FORBIDDEN_NAMES = new Set(['atlas_prod', 'atlas_production', 'production', 'prod']);

export function assessDatabaseIsolation(env: IsolationEnv): IsolationVerdict {
  const database = (env.DB_NAME ?? '').trim();
  if (!database) return { allowed: false, reason: 'DB_NAME no está definido: no se sabe contra qué base correría la suite.' };
  if (env[ISOLATION_FLAG] !== 'true') {
    return {
      allowed: false,
      reason: `${ISOLATION_FLAG}=true no está presente. La bandera es una decisión explícita de quien ejecuta; NODE_ENV=test no la sustituye.`,
    };
  }
  if (FORBIDDEN_NAMES.has(database.toLowerCase())) {
    return { allowed: false, reason: `La base «${database}» es productiva por nombre y no se acepta ni con autorización.` };
  }
  const authorized = (env[AUTHORIZED_NAME] ?? '').trim();
  if (authorized && authorized === database) return { allowed: true, database };
  if (/test/i.test(database)) return { allowed: true, database };
  return {
    allowed: false,
    reason: `La base «${database}» no se identifica como de prueba (su nombre no contiene «test»). Autorízala nominalmente con ${AUTHORIZED_NAME}=${database} si es desechable.`,
  };
}

/** Lanza con la causa si la base no está aislada; devuelve el nombre autorizado si lo está. */
export function requireIsolatedDatabase(env: IsolationEnv = process.env): string {
  const verdict = assessDatabaseIsolation(env);
  if (!verdict.allowed) throw new Error(`Base de pruebas no aislada: ${verdict.reason}`);
  return verdict.database;
}
