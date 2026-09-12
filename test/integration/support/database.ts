/**
 * @file Conexión a la base de pruebas de integración y política de salto (AT-002).
 * @business Las garantías que estas pruebas miden —rollback, unicidad, leases, permisos— sólo
 *   existen en PostgreSQL; un doble en memoria las daría por buenas sin haberlas probado.
 * @system Abre una instancia de Sequelize con TODOS los modelos del monolito contra la base que
 *   describen las variables `DB_*` (`test/setup-jest-env.cjs` fija `DB_NAME=atlas_test` si no
 *   viene otra). Si la base no responde, la suite FALLA con la causa; sólo salta si alguien lo pidió
 *   con `ATLAS_GATES_ALLOW_SKIP=true`, la misma política que `scripts/gate-skip-policy.ts` (ATLAS-CI-002).
 */
import { Sequelize } from 'sequelize-typescript';
import { buildSequelizeOptions } from '../../../src/config/database.config.js';
import { databaseModels } from '../../../src/database/database-models.js';
import { requireIsolatedDatabase } from '../../support/isolated-database.guard.js';

export type IntegrationDatabase = {
  sequelize: Sequelize;
  close: () => Promise<void>;
};

const SKIP_ENV = 'ATLAS_GATES_ALLOW_SKIP';

/** Verdadero cuando quien ejecuta pidió explícitamente saltar sin base. CI nunca lo pide. */
export function integrationSkipRequested(): boolean {
  return process.env[SKIP_ENV] === 'true';
}

/**
 * Abre la base de integración. Devuelve `null` únicamente en modo de salto explícito; en cualquier
 * otro caso una base inalcanzable es un error de la suite, no un aprobado.
 */
export async function openIntegrationDatabase(): Promise<IntegrationDatabase | null> {
  // Antes de abrir nada: la base tiene que estar declarada como aislada (guarda de AT-002). Un
  // nombre productivo o la ausencia de la bandera detienen la suite aquí, antes de la primera consulta.
  requireIsolatedDatabase();
  const options = buildSequelizeOptions();
  const sequelize = new Sequelize({ ...options, models: databaseModels, logging: false });
  try {
    await sequelize.authenticate();
  } catch (error) {
    await sequelize.close().catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    const where = `${options.host}:${options.port}/${options.database} como ${options.username}`;
    if (integrationSkipRequested()) {
      console.warn(`[skip] integración: sin PostgreSQL en ${where} (${message}). Salto explícito por ${SKIP_ENV}=true.`);
      return null;
    }
    throw new Error(
      `Las pruebas de integración necesitan PostgreSQL en ${where} y no respondió: ${message}. ` +
        `Levanta la base (docker compose up -d postgres; DB_NAME=atlas_test yarn db:migration:up) ` +
        `o pide el salto con ${SKIP_ENV}=true si de verdad quieres omitirlas.`,
      { cause: error },
    );
  }
  return { sequelize, close: () => sequelize.close() };
}

/** Identificador único por corrida para que dos ejecuciones no compartan filas ni claves. */
export function runToken(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
