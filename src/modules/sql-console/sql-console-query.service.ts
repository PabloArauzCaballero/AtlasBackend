/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza deja consultar los datos gobernados sin poder alterarlos ni extraer credenciales.
 * @system valida y ejecuta una consulta de solo lectura sobre read_api, enmascarando la PII.
 */
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { ReadQueryService } from '../../common/database/read-query.service.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { applyColumnPolicies, describeColumns } from '../data-notebook/data-notebook-masking.js';
import { guardSqlStatement, SqlViolation } from './sql-statement-guard.js';
import { SQL_CONSOLE_LIMITS, SQL_CONSOLE_REVEAL_ROLES } from './sql-console.constants.js';

export type QueryEstimate = {
  estimatedRows: number;
  estimatedBytes: number;
  planCost: number;
  scannedRelations: string[];
};

export type QueryValidation = { valid: boolean; violations: SqlViolation[]; estimate?: QueryEstimate };

export type QueryResult = {
  columns: { name: string; kind: string }[];
  /** Filas como MATRIZ: dos columnas pueden llamarse igual (`SELECT a.id, b.id`) y un objeto perdería una. */
  rows: (string | number | boolean | null)[][];
  rowCount: number;
  durationMs: number;
  truncated: boolean;
  estimate: QueryEstimate;
};

type PlanRow = { 'QUERY PLAN': Array<{ Plan: { 'Total Cost': number; 'Plan Rows': number; 'Plan Width': number } }> };

@Injectable()
export class SqlConsoleQueryService {
  private esquemasCache: string[] | null = null;

  constructor(private readonly readQuery: ReadQueryService) {}

  /**
   * El «dry run»: planifica sin leer una fila.
   *
   * Un `EXPLAIN` sin `ANALYZE` no ejecuta la consulta, así que se puede ofrecer antes de decidir:
   * dice cuánto costaría y qué relaciones tocaría. Es lo que permite avisar de un barrido completo
   * ANTES de lanzarlo contra la base, en vez de después.
   */
  async validate(statement: string): Promise<QueryValidation> {
    const verdict = guardSqlStatement(statement);
    if (!verdict.ok) return { valid: false, violations: verdict.violations };

    try {
      const estimate = await this.explain(verdict.statement);
      return { valid: true, violations: [], estimate };
    } catch (error) {
      // Que Postgres no pueda planificarla es una validación NEGATIVA, no un fallo de la petición:
      // la respuesta sigue siendo 200 con el motivo dentro, que es lo que la consola sabe pintar.
      return {
        valid: false,
        violations: [{ code: 'SQL_PLAN_FAILED', message: mensajeDe(error) }],
      };
    }
  }

  async execute(statement: string, user: AuthenticatedUser): Promise<QueryResult> {
    const verdict = guardSqlStatement(statement);
    if (!verdict.ok) {
      /*
       * Se lanza una excepcion de DOMINIO, no un Error pelado.
       *
       * Con un `Error` corriente Nest respondia 500 «Error interno no controlado», y el mensaje
       * exacto del guard —«esta relacion guarda credenciales», «la palabra DELETE no se admite»—
       * moria en el camino. Quien escribia la consulta veia un fallo del servidor y no sabia que
       * habia sido rechazado ni por que: exactamente el «obliga a adivinar» que el guard existe
       * para evitar. Ademas un 500 es mentira — la peticion se entendio perfectamente y se decidio
       * no atenderla, que es 422.
       */
      throw new UnprocessableEntityException({
        code: verdict.violations[0].code,
        message: verdict.violations[0].message,
        violations: verdict.violations,
      });
    }

    const iniciado = Date.now();
    const estimate = await this.explain(verdict.statement);
    const filas = await this.selectGuarded(verdict.statement);

    const truncated = filas.length > SQL_CONSOLE_LIMITS.maxRows;
    const servidas = truncated ? filas.slice(0, SQL_CONSOLE_LIMITS.maxRows) : filas;

    const nombres = servidas.length > 0 ? Object.keys(servidas[0]) : [];
    const reveal = SQL_CONSOLE_REVEAL_ROLES.includes(user.role);
    // MISMAS políticas que el cuaderno: las dos pantallas leen la misma superficie, y que una
    // enmascarara y la otra no convertiría la elección de herramienta en un modo de esquivarlo.
    const politicas = describeColumns(nombres, reveal);
    const enmascaradas = applyColumnPolicies(servidas, politicas);

    return {
      columns: politicas.map((politica) => ({ name: politica.name, kind: 'texto' })),
      rows: enmascaradas.map((fila) => nombres.map((nombre) => normalizar(fila[nombre]))),
      rowCount: servidas.length,
      durationMs: Date.now() - iniciado,
      truncated,
      estimate,
    };
  }

  /**
   * Ejecuta dentro de una transacción de SOLO LECTURA, con plazo y con el `search_path` fijado.
   *
   * Las tres cosas son de la base, no del análisis léxico, y por eso valen: aunque el guard se
   * equivocara, `READ ONLY` hace que Postgres rechace cualquier escritura, el `statement_timeout`
   * corta un barrido eterno, y el `search_path` acotado impide que un nombre sin calificar resuelva
   * a una tabla de otro esquema.
   */
  private async selectGuarded(statement: string): Promise<Record<string, unknown>[]> {
    const sequelize = this.readQuery.getConnection();
    const transaccion = await sequelize.transaction();

    try {
      await sequelize.query('SET TRANSACTION READ ONLY', { transaction: transaccion });
      await sequelize.query(`SET LOCAL statement_timeout = ${SQL_CONSOLE_LIMITS.timeoutMs}`, {
        transaction: transaccion,
      });
      /*
       * El `search_path` se DERIVA de los esquemas que existen, igual que el catalogo.
       *
       * Estaba escrito a mano y el catalogo ya no: un esquema nuevo aparecia en el explorador y sus
       * tablas no resolvian sin calificar, con un «relation does not exist» que culpa a quien
       * escribe la consulta de un desajuste entre dos listas que deberian ser una.
       *
       * Se compone del catalogo del servidor y nunca de la entrada del usuario, y los esquemas del
       * sistema siguen fuera: un nombre sin calificar sigue sin poder resolver a `pg_catalog`.
       */
      const esquemas = await this.esquemasDisponibles();
      await sequelize.query(`SET LOCAL search_path = ${esquemas.join(', ')}`, {
        transaction: transaccion,
      });

      // Se pide UNA fila más que el techo: es lo que distingue «hay exactamente mil» de «hay más
      // de mil», y sin esa fila extra `truncated` sería siempre falso.
      const filas = await sequelize.query(`SELECT * FROM (${statement}) AS consola LIMIT ${SQL_CONSOLE_LIMITS.maxRows + 1}`, {
        type: QueryTypes.SELECT,
        transaction: transaccion,
      });

      await transaccion.commit();
      return filas as Record<string, unknown>[];
    } catch (error) {
      await transaccion.rollback();
      throw error;
    }
  }

  /**
   * Los esquemas consultables, preguntados a Postgres y cacheados por proceso.
   *
   * Se entrecomillan porque un esquema puede llamarse como una palabra reservada, y el nombre sale
   * del catalogo del servidor — nunca de la peticion — asi que la interpolacion es segura.
   */
  private async esquemasDisponibles(): Promise<string[]> {
    if (this.esquemasCache) return this.esquemasCache;
    const filas = await this.readQuery.select<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace
        WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
        ORDER BY nspname`,
    );
    this.esquemasCache = filas.map((fila) => `"${fila.nspname.replace(/"/g, '""')}"`);
    return this.esquemasCache;
  }

  private async explain(statement: string): Promise<QueryEstimate> {
    const sequelize = this.readQuery.getConnection();
    const filas = (await sequelize.query(`EXPLAIN (FORMAT JSON) ${statement}`, {
      type: QueryTypes.SELECT,
    })) as unknown as PlanRow[];

    const plan = filas[0]?.['QUERY PLAN']?.[0]?.Plan;
    return {
      estimatedRows: plan?.['Plan Rows'] ?? 0,
      estimatedBytes: (plan?.['Plan Rows'] ?? 0) * (plan?.['Plan Width'] ?? 0),
      planCost: plan?.['Total Cost'] ?? 0,
      scannedRelations: relacionesDe(statement),
    };
  }
}

/** Las relaciones que la consulta nombra, para el historial y para el aviso de barrido. */
function relacionesDe(statement: string): string[] {
  const encontradas = new Set<string>();
  const patron = /\b(?:from|join)\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)/gi;
  let coincidencia = patron.exec(statement);
  while (coincidencia) {
    encontradas.add(coincidencia[1].toLowerCase());
    coincidencia = patron.exec(statement);
  }
  return [...encontradas];
}

/** La consola pinta valores planos: una fecha o un objeto viajan como texto, no como `[object Object]`. */
function normalizar(valor: unknown): string | number | boolean | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number' || typeof valor === 'boolean' || typeof valor === 'string') return valor;
  if (valor instanceof Date) return valor.toISOString();
  try {
    return JSON.stringify(valor);
  } catch {
    return String(valor);
  }
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : 'Postgres no pudo planificar la consulta.';
}
