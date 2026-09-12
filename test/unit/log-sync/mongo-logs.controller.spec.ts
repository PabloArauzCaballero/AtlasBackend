import { describe, expect, it, jest } from '@jest/globals';
import { MongoLogsController } from '../../../src/modules/log-sync/mongo-logs.controller.js';

/** `MongoLogsController` delega el listado paginado de logs en `MongoLogsQueryService`. */
describe('MongoLogsController', () => {
  it('listMongoLogs delega la query en el servicio', async () => {
    const service = { listLogs: jest.fn(async (..._args: unknown[]) => ({ items: [], meta: {} })) };
    const controller = new MongoLogsController(service as never);
    const query = { page: 1, limit: 10, type: 'error' } as never;
    await controller.listMongoLogs(query);
    expect(service.listLogs).toHaveBeenCalledWith(query);
  });
});
