import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

/**
 * Token de la conexión efectiva de LECTURA. `ReadDatabaseModule` lo enlaza a la conexión "read"
 * (atlas_app_ro / réplica) cuando `DB_READ_ENABLED=true`, o a la conexión por defecto cuando está
 * apagado. Así `ReadQueryService` siempre recibe una Sequelize válida y compila sin acoplarse a que
 * exista un segundo pool.
 */
export const READ_CONNECTION = Symbol('ATLAS_READ_CONNECTION');

/**
 * Servicio de consultas de LECTURA sobre vistas de `read_api`. Fase 5 del plan.
 *
 * Diseño deliberado (§31):
 * - La conexión es EXPLÍCITA (inyectada), no "mágica" según el tipo de query.
 * - Solo ejecuta SELECT/WITH: rechaza cualquier otra sentencia como defensa, porque en modo
 *   degradado la conexión subyacente puede ser la de escritura.
 * - No usar para auth, outbox, idempotencia, riesgo transaccional ni read-after-write.
 */
@Injectable()
export class ReadQueryService {
  constructor(@Inject(READ_CONNECTION) private readonly sequelize: Sequelize) {}

  async select<T extends object = Record<string, unknown>>(sql: string, replacements: Record<string, unknown> = {}): Promise<T[]> {
    this.assertReadOnly(sql);
    return (await this.sequelize.query(sql, { type: QueryTypes.SELECT, replacements })) as T[];
  }

  async selectOne<T extends object = Record<string, unknown>>(sql: string, replacements: Record<string, unknown> = {}): Promise<T | null> {
    const rows = await this.select<T>(sql, replacements);
    return rows[0] ?? null;
  }

  /** Acceso directo a la conexión de lectura para casos que necesiten el objeto Sequelize. */
  getConnection(): Sequelize {
    return this.sequelize;
  }

  private assertReadOnly(sql: string): void {
    const normalized = sql.trimStart().toLowerCase();
    if (!normalized.startsWith('select') && !normalized.startsWith('with')) {
      throw new Error('ReadQueryService solo permite consultas SELECT/WITH. Usa la conexión de escritura para mutaciones.');
    }
  }
}
