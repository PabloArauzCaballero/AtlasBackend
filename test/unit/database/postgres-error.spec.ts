import { describe, expect, it } from '@jest/globals';
import { HttpStatus } from '@nestjs/common';
import { DatabaseError, UniqueConstraintError } from 'sequelize';
import {
  classifySqlState,
  extractSqlState,
  normalizePostgresError,
  type PostgresFailureKind,
} from '../../../src/common/database/postgres-error.js';

type DriverError = Error & { code?: string; sql?: string };

/** Error crudo del driver `pg`: SQLSTATE en la raíz, sin envoltorio de Sequelize. */
function buildDriverError(code: string): DriverError {
  const error = new Error('driver failure') as DriverError;
  error.code = code;
  return error;
}

/** Error de Sequelize: el del driver queda en `original`/`parent`. */
function buildSequelizeError(code: string): DatabaseError {
  const driverError = buildDriverError(code);
  driverError.sql = 'SELECT 1';
  return new DatabaseError(driverError as DriverError & { sql: string });
}

describe('extractSqlState', () => {
  it('lee el SQLSTATE de un error crudo del driver', () => {
    expect(extractSqlState(buildDriverError('23505'))).toBe('23505');
  });

  it('atraviesa el envoltorio de Sequelize hasta el error del driver', () => {
    expect(extractSqlState(buildSequelizeError('40001'))).toBe('40001');
  });

  it('encuentra el código en un error anidado a varios niveles', () => {
    const inner = buildDriverError('57014');
    const middle = Object.assign(new Error('middle'), { original: inner });
    const outer = Object.assign(new Error('outer'), { original: middle });
    expect(extractSqlState(outer)).toBe('57014');
  });

  it('ignora códigos de error de red de Node, que no son SQLSTATE', () => {
    // `ECONNREFUSED` también viaja en `code`; sin la comprobación de forma se clasificaría mal.
    expect(extractSqlState(Object.assign(new Error('boom'), { code: 'ECONNREFUSED' }))).toBeNull();
  });

  it('devuelve null para valores que no son errores o no traen código', () => {
    expect(extractSqlState(new Error('sin código'))).toBeNull();
    expect(extractSqlState(null)).toBeNull();
    expect(extractSqlState(undefined)).toBeNull();
    expect(extractSqlState('cadena')).toBeNull();
  });

  it('no entra en bucle infinito si el error se referencia a sí mismo', () => {
    const cyclic = new Error('cyclic') as Error & { original?: unknown };
    cyclic.original = cyclic;
    expect(extractSqlState(cyclic)).toBeNull();
  });
});

describe('classifySqlState', () => {
  const cases: { sqlState: string; kind: PostgresFailureKind; httpStatus: number; retryable: boolean; operatorFault: boolean }[] = [
    { sqlState: '23505', kind: 'duplicate_entity', httpStatus: HttpStatus.CONFLICT, retryable: false, operatorFault: false },
    { sqlState: '23503', kind: 'foreign_key_conflict', httpStatus: HttpStatus.CONFLICT, retryable: false, operatorFault: false },
    {
      sqlState: '23502',
      kind: 'required_field',
      httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
      retryable: false,
      operatorFault: false,
    },
    {
      sqlState: '23514',
      kind: 'check_violation',
      httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
      retryable: false,
      operatorFault: false,
    },
    { sqlState: '40001', kind: 'serialization_conflict', httpStatus: HttpStatus.CONFLICT, retryable: true, operatorFault: false },
    { sqlState: '40P01', kind: 'deadlock_detected', httpStatus: HttpStatus.CONFLICT, retryable: true, operatorFault: false },
    {
      sqlState: '42501',
      kind: 'insufficient_privilege',
      httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
      retryable: false,
      operatorFault: true,
    },
    {
      sqlState: '25006',
      kind: 'read_only_transaction',
      httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
      retryable: false,
      operatorFault: true,
    },
    { sqlState: '57014', kind: 'query_timeout', httpStatus: HttpStatus.GATEWAY_TIMEOUT, retryable: true, operatorFault: true },
    {
      sqlState: '53300',
      kind: 'too_many_connections',
      httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
      retryable: true,
      operatorFault: true,
    },
  ];

  it.each(cases)('clasifica $sqlState como $kind', ({ sqlState, kind, httpStatus, retryable, operatorFault }) => {
    const result = classifySqlState(sqlState);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe(kind);
    expect(result?.httpStatus).toBe(httpStatus);
    expect(result?.retryable).toBe(retryable);
    expect(result?.operatorFault).toBe(operatorFault);
    expect(result?.sqlState).toBe(sqlState);
  });

  it.each(['08000', '08003', '08006', '08001', '08P01'])('trata la clase 08 (%s) como conexión no disponible', (sqlState) => {
    const result = classifySqlState(sqlState);
    expect(result?.kind).toBe('connection_unavailable');
    expect(result?.httpStatus).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(result?.retryable).toBe(true);
  });

  it('devuelve null para códigos que no modelamos, en vez de inventar semántica', () => {
    // 42703 = columna inexistente: es un bug de esquema, debe seguir siendo un 500 genérico.
    expect(classifySqlState('42703')).toBeNull();
    expect(classifySqlState('00000')).toBeNull();
  });

  it('nunca expone el SQLSTATE ni nombres de objetos en el mensaje al cliente', () => {
    for (const { sqlState } of cases) {
      const message = classifySqlState(sqlState)?.clientMessage ?? '';
      expect(message).not.toContain(sqlState);
      expect(message).not.toMatch(/table|column|constraint|relation|tabla|columna/i);
    }
  });

  it('los fallos de privilegio y de transacción read-only devuelven un mensaje opaco', () => {
    // Un 42501 no debe decirle al cliente que a un rol le falta un GRANT.
    expect(classifySqlState('42501')?.clientMessage).toBe('Error interno no controlado.');
    expect(classifySqlState('25006')?.clientMessage).toBe('Error interno no controlado.');
  });
});

describe('normalizePostgresError', () => {
  it('normaliza un UniqueConstraintError de Sequelize a duplicate_entity', () => {
    const driverError = buildDriverError('23505');
    const error = new UniqueConstraintError({ parent: driverError as DriverError & { sql: string }, errors: [] });
    expect(normalizePostgresError(error)?.kind).toBe('duplicate_entity');
  });

  it('normaliza una consulta cruda fallida, que no produce UniqueConstraintError', () => {
    expect(normalizePostgresError(buildDriverError('23503'))?.kind).toBe('foreign_key_conflict');
  });

  it('devuelve null cuando el error no viene de PostgreSQL', () => {
    expect(normalizePostgresError(new Error('fallo de negocio'))).toBeNull();
  });
});
