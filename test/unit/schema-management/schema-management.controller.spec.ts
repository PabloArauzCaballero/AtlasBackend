import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { SchemaManagementController } from '../../../src/modules/schema-management/schema-management.controller.js';

/**
 * `SchemaManagementController` (catálogo DDL solo-lectura + propuestas 4-ojos) desempaqueta los
 * campos de la query al delegar en `SchemaManagementService`. Spec directo que verifica ese
 * desempaquetado y el paso del user en las mutaciones.
 */
describe('SchemaManagementController', () => {
  function build() {
    const service = {
      listSchemaVersions: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
      getSchemaVersion: jest.fn(async (..._args: unknown[]) => ({ id: 'v1' })),
      listSchemaTables: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
      getSchemaTable: jest.fn(async (..._args: unknown[]) => ({ id: 't1' })),
      proposeNewTable: jest.fn(async (..._args: unknown[]) => ({ changeId: 'c1' })),
      listSchemaChangeLog: jest.fn(async (..._args: unknown[]) => ({ items: [] })),
      approveSchemaChange: jest.fn(async (..._args: unknown[]) => ({ decided: true })),
    };
    return { controller: new SchemaManagementController(service as never), service };
  }
  const user = { role: 'platform_admin', tenantId: '1', internalUserId: 'u1' } as never;

  it('las lecturas desempaquetan los campos de la query', async () => {
    const { controller, service } = build();
    await controller.listVersions({ limit: 10, offset: 0, includeInactive: true, q: 'v2' } as never);
    await controller.getVersion('v1');
    await controller.listTables({ versionId: 'v1', tableType: 'core', limit: 5, offset: 2, q: 'loan' } as never);
    await controller.getTable('t1');
    await controller.listChangeLog({
      approvalStatus: 'pending',
      changeType: 'create',
      requesterUserId: 'u9',
      limit: 20,
      offset: 0,
      q: 'customers',
    } as never);
    // El buscador `q` viaja hasta el servicio en las tres lecturas (antes no existía).
    expect(service.listSchemaVersions).toHaveBeenCalledWith(10, 0, true, 'v2');
    expect(service.getSchemaVersion).toHaveBeenCalledWith('v1');
    // El quinto argumento es `schemaName`: acota el inventario a un esquema de datos (`iam`,
    // `risk`…). Sin él, «las tablas de riesgo» no se podían pedir — el catálogo guarda el nombre
    // cualificado y el techo de página es de 100 filas sobre 152 tablas.
    expect(service.listSchemaTables).toHaveBeenCalledWith('v1', 'core', 5, 2, { schemaName: undefined, q: 'loan' });
    expect(service.getSchemaTable).toHaveBeenCalledWith('t1');
    expect(service.listSchemaChangeLog).toHaveBeenCalledWith(
      { approvalStatus: 'pending', changeType: 'create', requesterUserId: 'u9', q: 'customers' },
      20,
      0,
    );
  });

  it('proposeTable y approveChange delegan pasando el user', async () => {
    const { controller, service } = build();
    const proposal = { tableName: 'x' } as never;
    const decision = { approvalStatus: 'approved' } as never;
    await controller.proposeTable(proposal, user);
    await controller.approveChange('c1', decision, user);
    expect(service.proposeNewTable).toHaveBeenCalledWith(proposal, user);
    expect(service.approveSchemaChange).toHaveBeenCalledWith('c1', decision, user);
  });

  /*
   * Las columnas `_id` son BIGINT: un id no numérico llegaba a Postgres como 22P02 y salía 500. Los
   * tres ids de ruta pasan por el pipe, que lo corta antes con 400.
   */
  it.each(['getVersion', 'getTable', 'approveChange'] as const)('%s rechaza con 400 un id de ruta no numérico', (metodo) => {
    const argumentos = Reflect.getMetadata('__routeArguments__', SchemaManagementController, metodo) as Record<
      string,
      { index: number; pipes: { transform: (value: unknown, meta: object) => unknown }[] }
    >;
    const parametro = Object.values(argumentos).find((argumento) => argumento.index === 0);
    const pipe = parametro?.pipes[0];

    expect(pipe).toBeDefined();
    expect(() => pipe!.transform('abc', { type: 'param' })).toThrow(BadRequestException);
    expect(pipe!.transform('42', { type: 'param' })).toBe('42');
  });
});
