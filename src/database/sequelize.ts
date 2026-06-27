import { Sequelize } from 'sequelize-typescript';
import { buildSequelizeOptions } from '../config/database.config.js';

/**
 * Crea una instancia de Sequelize para migraciones y tareas de infraestructura.
 *
 * No registra modelos porque esta fase implementa únicamente migraciones.
 */
export function createSequelizeInstance(): Sequelize {
  const options = buildSequelizeOptions();

  return new Sequelize({
    ...options,
    models: [],
  });
}
