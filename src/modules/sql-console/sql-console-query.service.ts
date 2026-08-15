/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza deja consultar los datos gobernados sin poder alterarlos ni extraer credenciales.
 * @system valida y ejecuta una consulta de solo lectura sobre read_api, enmascarando la PII.
 */
import { Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { ReadQueryService } from '../../common/database/read-query.service.js';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { applyColumnPolicies, describeColumns } from '../data-notebook/data-notebook-masking.js';
import { guardSqlStatement, SqlViolation } from './sql-statement-guard.js';
import { SQL_CONSOLE_LIMITS, SQL_CONSOLE_REVEAL_ROLES, SQL_CONSOLE_SCHEMA } from './sql-console.constants.js';

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
      const error = new Error(verdict.violations[0].message);
      error.name = verdict.violations[0].code;
      throw error;
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
      await sequelize.query(`SET LOCAL search_path = ${SQL_CONSOLE_SCHEMA}, pg_catalog`, {
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
