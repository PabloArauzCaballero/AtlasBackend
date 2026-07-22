import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { DatabaseError } from 'sequelize';
import { HttpExceptionFilter } from '../../../../src/common/filters/http-exception.filter.js';

/**
 * Endurecimiento de diagnóstico: un fallo real de Postgres (columna inexistente por migración
 * pendiente) se registraba como «[500] Error interno no controlado.» sin el mensaje del driver,
 * lo que obligó a reconstruir la causa a mano comparando modelo contra esquema. El filtro debe:
 *
 * 1. Registrar en el log la causa interna real (mensaje del driver + código SQLSTATE) de los 5xx.
 * 2. NO registrar el SQL (Sequelize inlinea valores en la consulta → riesgo de filtrar datos).
 * 3. Seguir devolviendo al cliente el mensaje saneado, sin detalles internos.
 */

type DriverError = Error & { code?: string; sql?: string };

function buildDatabaseError(input: { message: string; code: string; sql: string }): DatabaseError {
  const driverError = new Error(input.message) as DriverError;
  driverError.code = input.code;
  driverError.sql = input.sql;
  return new DatabaseError(driverError as DriverError & { sql: string });
}

function buildHost(): { host: ArgumentsHost; statusMock: jest.Mock; jsonMock: jest.Mock } {
  const jsonMock = jest.fn();
  const statusMock = jest.fn(() => ({ json: jsonMock }));
  const request = { method: 'POST', url: '/api/v1/internal/auth/login', correlationId: 'test-correlation-id' };

  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status: statusMock }),
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, statusMock, jsonMock };
}

describe('HttpExceptionFilter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registra la causa del driver (mensaje de Postgres + SQLSTATE) en los errores 5xx', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host } = buildHost();

    const exception = buildDatabaseError({
      message: 'no existe la columna «mfa_enabled»',
      code: '42703',
      sql: 'SELECT "mfa_enabled" FROM "auth_credentials"',
    });

    new HttpExceptionFilter().catch(exception, host);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedMessage = String(errorSpy.mock.calls[0]?.[0]);
    expect(loggedMessage).toContain('no existe la columna «mfa_enabled»');
    expect(loggedMessage).toContain('[42703]');
  });

  it('no registra el SQL de la consulta fallida en el log', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host } = buildHost();

    const exception = buildDatabaseError({
      message: 'no existe la columna «mfa_enabled»',
      code: '42703',
      sql: "SELECT * FROM auth_credentials WHERE actor_id = '12345'",
    });

    new HttpExceptionFilter().catch(exception, host);

    const allLoggedArguments = errorSpy.mock.calls.flat().map((argument) => String(argument));
    for (const loggedArgument of allLoggedArguments) {
      expect(loggedArgument).not.toContain("actor_id = '12345'");
    }
  });

  it('mantiene saneada la respuesta al cliente aunque el log incluya la causa interna', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, statusMock, jsonMock } = buildHost();

    const exception = buildDatabaseError({
      message: 'no existe la columna «mfa_enabled»',
      code: '42703',
      sql: 'SELECT 1',
    });

    new HttpExceptionFilter().catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = jsonMock.mock.calls[0]?.[0] as { error: { code: string; message: string } };
    expect(body.error.message).toBe('Error interno no controlado.');
    expect(JSON.stringify(body)).not.toContain('mfa_enabled');
  });

  it('no duplica la causa cuando coincide con el mensaje ya registrado (HttpException 5xx)', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host } = buildHost();

    new HttpExceptionFilter().catch(new HttpException('Fallo interno puntual.', HttpStatus.INTERNAL_SERVER_ERROR), host);

    const loggedMessage = String(errorSpy.mock.calls[0]?.[0]);
    expect(loggedMessage).toBe('[500] Fallo interno puntual.');
  });

  it('los 4xx siguen registrándose como warn sin tocar el canal de error', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { host, statusMock } = buildHost();

    new HttpExceptionFilter().catch(new HttpException('Credenciales inválidas.', HttpStatus.UNAUTHORIZED), host);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(statusMock).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
  });
});
