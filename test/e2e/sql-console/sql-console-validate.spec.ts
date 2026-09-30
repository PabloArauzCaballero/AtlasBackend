import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SqlConsoleController } from '../../../src/modules/sql-console/sql-console.controller.js';
import { SqlConsoleCatalogService } from '../../../src/modules/sql-console/sql-console-catalog.service.js';
import { SqlConsoleQueryService } from '../../../src/modules/sql-console/sql-console-query.service.js';
import { DataNotebookHistoryService } from '../../../src/modules/data-notebook/data-notebook-history.service.js';
import { authHeader, buildGenericTestApp } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de `POST sql-console/validate`.
 *
 * `validate` es de solo lectura pese al verbo POST: la descripción del controlador lo dice
 * explícitamente («sin leer una sola fila») y no toca `DataNotebookHistoryService.record`, a
 * diferencia de `POST sql-console/query`, que sí registra cada intento. Esta suite prueba el
 * CONTRATO HTTP con `SqlConsoleQueryService.validate` simulado — no hay base real disponible en
 * este harness, así que no se afirma que la validación se ejecutó contra Postgres: eso sigue
 * siendo responsabilidad de las pruebas de `SqlConsoleQueryService` (unitarias/integración propias
 * del servicio). Lo que se demuestra acá es: quién entra, qué se valida en el borde, y que el
 * resultado del validador viaja tal cual al cliente.
 */
describe('SqlConsoleController — validate (e2e/supertest)', () => {
  let app: INestApplication;

  const catalog = { datasets: jest.fn(async () => []), limits: jest.fn(() => ({})) };
  const queries = {
    validate: jest.fn((statement: string) => ({ valid: !statement.toLowerCase().includes('drop'), violations: [] })),
    execute: jest.fn(async () => ({ rows: [], columns: [], rowCount: 0, durationMs: 1 })),
  };
  const history = { record: jest.fn(async () => undefined), listOwn: jest.fn(async () => ({ rows: [] })) };

  beforeAll(async () => {
    app = await buildGenericTestApp(
      [SqlConsoleController],
      [
        { provide: SqlConsoleCatalogService, useValue: catalog },
        { provide: SqlConsoleQueryService, useValue: queries },
        { provide: DataNotebookHistoryService, useValue: history },
      ],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('rechaza con 401 sin token', async () => {
    await request(app.getHttpServer()).post('/sql-console/validate').send({ statement: 'select 1' }).expect(401);
    expect(queries.validate).not.toHaveBeenCalled();
  });

  it('un rol sin acceso a la consola (customer) recibe 403', async () => {
    // SQL_CONSOLE_ROLES no incluye `customer` ni `internal_operator`: es exclusiva de
    // administración, auditoría de solo lectura y los analistas de riesgo/cumplimiento.
    await request(app.getHttpServer())
      .post('/sql-console/validate')
      .set(...authHeader('customer'))
      .send({ statement: 'select 1' })
      .expect(403);
    expect(queries.validate).not.toHaveBeenCalled();
  });

  it('un internal_operator NO está en SQL_CONSOLE_ROLES y recibe 403', async () => {
    await request(app.getHttpServer())
      .post('/sql-console/validate')
      .set(...authHeader('internal_operator'))
      .send({ statement: 'select 1' })
      .expect(403);
    expect(queries.validate).not.toHaveBeenCalled();
  });

  it('una sentencia vacía se rechaza en el borde (400), sin llegar al validador', async () => {
    await request(app.getHttpServer())
      .post('/sql-console/validate')
      .set(...authHeader('risk_analyst'))
      .send({ statement: '' })
      .expect(400);
    expect(queries.validate).not.toHaveBeenCalled();
  });

  it('un risk_analyst valida una sentencia y recibe el veredicto del servicio (200)', async () => {
    const response = await request(app.getHttpServer())
      .post('/sql-console/validate')
      .set(...authHeader('risk_analyst'))
      .send({ statement: 'select 1 from read_api.customers limit 1' })
      .expect(201);

    expect(response.body).toMatchObject({ valid: true });
    expect(queries.validate).toHaveBeenCalledTimes(1);
    expect(queries.validate).toHaveBeenCalledWith('select 1 from read_api.customers limit 1');
    // `validate` no es `query`: no deja rastro en el historial de consultas.
    expect(history.record).not.toHaveBeenCalled();
  });

  it('una consulta con DROP la marca inválida sin ejecutarla — el doble del validador refleja el contrato de rechazo', async () => {
    const response = await request(app.getHttpServer())
      .post('/sql-console/validate')
      .set(...authHeader('platform_admin'))
      .send({ statement: 'drop table read_api.customers' })
      .expect(201);

    expect(response.body).toMatchObject({ valid: false });
  });
});
