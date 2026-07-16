import { Sequelize } from 'sequelize-typescript';
import { buildMigrationSequelizeOptions, buildSequelizeOptions } from '../config/database.config.js';

/**
 * Crea una instancia de Sequelize para tareas de infraestructura con la identidad de RUNTIME.
 *
 * No registra modelos porque estas tareas trabajan con SQL directo.
 */
export function createSequelizeInstance(): Sequelize {
  const options = buildSequelizeOptions();

  return new Sequelize({
    ...options,
    models: [],
  });
}

/**
 * Crea la instancia usada por MIGRACIONES y SEEDS (DDL).
 *
 * Usa `DB_MIGRATION_USER`/`DB_MIGRATION_PASSWORD` (p. ej. `atlas_migrator`) cuando están
 * configurados; si no, cae a la identidad de runtime. Esto permite que el runtime corra como
 * `atlas_app_rw` (sin DDL) sin romper `db:migration:up` / `db:seed:*`.
 */
export function createMigrationSequelizeInstance(): Sequelize {
  const options = buildMigrationSequelizeOptions();

  return new Sequelize({
    ...options,
    models: [],
  });
}
