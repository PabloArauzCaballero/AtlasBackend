import { DynamicModule, Global, Logger, Module } from '@nestjs/common';
import { getConnectionToken, SequelizeModule } from '@nestjs/sequelize';
import { buildReadSequelizeOptions, isDedicatedReadConnection } from '../config/database.config.js';
import { env } from '../config/env.js';
import { READ_CONNECTION, ReadQueryService } from '../common/database/read-query.service.js';

export const READ_CONNECTION_NAME = 'read';

/**
 * Fase 5 del plan: conexión read-only OPCIONAL.
 *
 * - `DB_READ_ENABLED=true` + `DB_READ_HOST`/`DB_READ_USER` → registra un segundo pool Sequelize "read"
 *   (apúntalo a atlas_app_ro y, en el futuro, a una réplica). `ReadQueryService` usa ese pool.
 * - `DB_READ_ENABLED=true` sin host/usuario dedicados → degradación EXPLÍCITA: el pool read usa las
 *   credenciales de escritura. Se registra un warning (nunca silencioso, §31).
 * - `DB_READ_ENABLED=false` → no se abre un segundo pool; `ReadQueryService` usa la conexión por
 *   defecto (write). Cero overhead.
 *
 * Es `@Global` para que los repositorios de consulta puedan inyectar `ReadQueryService` sin
 * re-importar el módulo. La conexión, sin embargo, es siempre explícita dentro del servicio.
 */
@Global()
@Module({})
export class ReadDatabaseModule {
  static register(): DynamicModule {
    const logger = new Logger(ReadDatabaseModule.name);

    if (env.DB_READ_ENABLED) {
      if (isDedicatedReadConnection()) {
        logger.log('Pool read-only dedicado activado (DB_READ_* apunta a un host/usuario distinto, idealmente atlas_app_ro).');
      } else {
        logger.warn(
          'DB_READ_ENABLED=true pero DB_READ_HOST/DB_READ_USER no están configurados: el pool "read" usará las ' +
            'credenciales de ESCRITURA (degradación explícita). Configura atlas_app_ro para separar lecturas.',
        );
      }

      return {
        module: ReadDatabaseModule,
        imports: [SequelizeModule.forRoot({ ...buildReadSequelizeOptions(), name: READ_CONNECTION_NAME })],
        providers: [{ provide: READ_CONNECTION, useExisting: getConnectionToken(READ_CONNECTION_NAME) }, ReadQueryService],
        exports: [ReadQueryService],
      };
    }

    logger.log('Pool read-only NO activado (DB_READ_ENABLED=false): las lecturas usan la conexión por defecto (write).');
    return {
      module: ReadDatabaseModule,
      providers: [{ provide: READ_CONNECTION, useExisting: getConnectionToken() }, ReadQueryService],
      exports: [ReadQueryService],
    };
  }
}
