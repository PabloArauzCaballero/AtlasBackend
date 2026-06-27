import { SequelizeModuleOptions } from '@nestjs/sequelize';
import { env } from './env.js';

export function buildSequelizeOptions(): SequelizeModuleOptions {
  return {
    dialect: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    schema: env.DB_SCHEMA,
    autoLoadModels: false,
    synchronize: false,
    logging: env.NODE_ENV === 'development' ? console.log : false,
    dialectOptions: env.DB_SSL
      ? {
          ssl: {
            require: true,
            rejectUnauthorized: false,
          },
        }
      : undefined,
  };
}
