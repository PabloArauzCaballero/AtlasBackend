import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ArgumentsHost, ConflictException, HttpStatus, Logger } from '@nestjs/common';
import { DatabaseError, UniqueConstraintError, ValidationError } from 'sequelize';
import { HttpExceptionFilter } from '../../../../src/common/filters/http-exception.filter.js';

/**
 * Contrato HTTP de los errores PostgreSQL normalizados (§33).
 *
 * Antes, cualquier fallo que no fuera `UniqueConstraintError` terminaba como 500 genérico: una
 * consulta cruda que violaba una FK, un deadlock o —lo más grave— una escritura enrutada por la
 * conexión read-only eran indistinguibles de un bug cualquiera. Aquí se fija que cada SQLSTATE
 * conocido produce el estado correcto sin filtrar detalles internos al cliente.
 */

type DriverError = Error & { code?: string; sql?: string };

function buildDatabaseError(code: string, message = 'fallo del motor'): DatabaseError {
  const driverError = new Error(message) as DriverError;
  driverError.code = code;
  driverError.sql = 'SELECT * FROM customers WHERE identifier = $1';
  return new DatabaseError(driverError as DriverError & { sql: string });
}

function buildHost(): { host: ArgumentsHost; statusMock: jest.Mock; jsonMock: jest.Mock } {
  const jsonMock = jest.fn();
  const statusMock = jest.fn((..._args: unknown[]) => ({ json: jsonMock }));
  const request = { method: 'POST', url: '/api/v1/customers?identifier=0999123456', correlationId: 'cid-1' };

  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status: statusMock }),
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, statusMock, jsonMock };
}

function bodyOf(jsonMock: jest.Mock): { error: { code: string; message: string } } {
  return jsonMock.mock.calls[0]?.[0] as { error: { code: string; message: string } };
}

describe('HttpExceptionFilter — normalización de errores PostgreSQL', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const cases: { sqlState: string; status: number; code: string }[] = [
    { sqlState: '23505', status: HttpStatus.CONFLICT, code: 'CONFLICT' },
    { sqlState: '23503', status: HttpStatus.CONFLICT, code: 'CONFLICT' },
    { sqlState: '23502', status: HttpStatus.UNPROCESSABLE_ENTITY, code: 'UNPROCESSABLE_ENTITY' },
    { sqlState: '23514', status: HttpStatus.UNPROCESSABLE_ENTITY, code: 'UNPROCESSABLE_ENTITY' },
    { sqlState: '40001', status: HttpStatus.CONFLICT, code: 'CONFLICT' },
    { sqlState: '40P01', status: HttpStatus.CONFLICT, code: 'CONFLICT' },
    { sqlState: '42501', status: HttpStatus.INTERNAL_SERVER_ERROR, code: 'INTERNAL_ERROR' },
    { sqlState: '25006', status: HttpStatus.INTERNAL_SERVER_ERROR, code: 'INTERNAL_ERROR' },
    { sqlState: '57014', status: HttpStatus.GATEWAY_TIMEOUT, code: 'GATEWAY_TIMEOUT' },
    { sqlState: '53300', status: HttpStatus.SERVICE_UNAVAILABLE, code: 'SERVICE_UNAVAILABLE' },
    { sqlState: '08006', status: HttpStatus.SERVICE_UNAVAILABLE, code: 'SERVICE_UNAVAILABLE' },
  ];

  it.each(cases)('traduce SQLSTATE $sqlState a HTTP $status', ({ sqlState, status, code }) => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { host, statusMock, jsonMock } = buildHost();

    new HttpExceptionFilter().catch(buildDatabaseError(sqlState), host);

    expect(statusMock).toHaveBeenCalledWith(status);
    expect(bodyOf(jsonMock).error.code).toBe(code);
  });

  it('nunca filtra el SQLSTATE, el SQL ni valores de la query al cuerpo de la respuesta', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { host, jsonMock } = buildHost();

    new HttpExceptionFilter().catch(buildDatabaseError('23503', 'viola la llave foránea «fk_customer»'), host);

    const serialized = JSON.stringify(bodyOf(jsonMock));
    expect(serialized).not.toContain('23503');
    expect(serialized).not.toContain('fk_customer');
    expect(serialized).not.toContain('0999123456');
    expect(serialized).not.toContain('SELECT');
  });

  it('registra un error dedicado cuando el fallo es de privilegios (42501)', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host } = buildHost();

    new HttpExceptionFilter().catch(buildDatabaseError('42501', 'permiso denegado a la tabla customers'), host);

    const logged = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('db:insufficient_privilege');
    expect(logged).toContain('42501');
  });

  it('registra un error dedicado cuando una escritura sale por la conexión read-only (25006)', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host } = buildHost();

    new HttpExceptionFilter().catch(buildDatabaseError('25006', 'no se pueden ejecutar INSERT en una transacción de solo lectura'), host);

    const logged = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('db:read_only_transaction');
  });

  it('no registra la alerta de operador para violaciones de integridad normales', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { host } = buildHost();

    new HttpExceptionFilter().catch(buildDatabaseError('23505'), host);

    // Un duplicado es entrada del cliente (409): no debe ensuciar el canal de alertas.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('respeta la excepción HTTP que un servicio ya tradujo, sin re-clasificar por SQLSTATE', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { host, statusMock, jsonMock } = buildHost();

    new HttpExceptionFilter().catch(new ConflictException('CREDIT_APPLICATION_ALREADY_OPEN'), host);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(bodyOf(jsonMock).error.message).toBe('CREDIT_APPLICATION_ALREADY_OPEN');
  });

  /**
   * El fallback por TIPO de Sequelize sigue siendo necesario después de introducir la clasificación
   * por SQLSTATE, y conviene que quede fijado: los validadores del propio Sequelize (`len`, `isEmail`,
   * `notNull` a nivel de modelo) lanzan sin llegar al motor, así que no hay SQLSTATE que clasificar.
   * Si alguien lo borrara por "código muerto", esos casos pasarían de 409 a 500.
   */
  it('mantiene el fallback a 409 para un ValidationError de Sequelize sin SQLSTATE', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { host, statusMock, jsonMock } = buildHost();

    new HttpExceptionFilter().catch(new ValidationError('validación de modelo', []), host);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(bodyOf(jsonMock).error.message).toBe('La operación viola una restricción de datos.');
  });

  it('mantiene el fallback a 409 para un UniqueConstraintError sin error de driver adjunto', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { host, statusMock, jsonMock } = buildHost();

    new HttpExceptionFilter().catch(new UniqueConstraintError({ errors: [] }), host);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(bodyOf(jsonMock).error.message).toBe('El recurso ya existe o viola una restricción única.');
  });

  it('deja como 500 genérico un SQLSTATE que no modelamos', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, statusMock, jsonMock } = buildHost();

    // 42703 = columna inexistente (migración pendiente): sigue siendo un bug nuestro, no un 4xx.
    new HttpExceptionFilter().catch(buildDatabaseError('42703'), host);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(bodyOf(jsonMock).error.message).toBe('Error interno no controlado.');
  });
});
