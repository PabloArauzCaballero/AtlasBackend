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
      listSchemaVersions: jest.fn(async () => ({ items: [] })),
      getSchemaVersion: jest.fn(async () => ({ id: 'v1' })),
      listSchemaTables: jest.fn(async () => ({ items: [] })),
      getSchemaTable: jest.fn(async () => ({ id: 't1' })),
      proposeNewTable: jest.fn(async () => ({ changeId: 'c1' })),
      listSchemaChangeLog: jest.fn(async () => ({ items: [] })),
      approveSchemaChange: jest.fn(async () => ({ decided: true })),
    };
    return { controller: new SchemaManagementController(service as never), service };
  }
  const user = { role: 'platform_admin', tenantId: '1', internalUserId: 'u1' } as never;

  it('las lecturas desempaquetan los campos de la query', async () => {
    const { controller, service } = build();
    await controller.listVersions({ limit: 10, offset: 0, includeInactive: true } as never);
    await controller.getVersion('v1');
    await controller.listTables({ versionId: 'v1', tableType: 'core', limit: 5, offset: 2 } as never);
    await controller.getTable('t1');
    await controller.listChangeLog({ approvalStatus: 'pending', changeType: 'create', requesterUserId: 'u9', limit: 20, offset: 0 } as never);
    expect(service.listSchemaVersions).toHaveBeenCalledWith(10, 0, true);
    expect(service.getSchemaVersion).toHaveBeenCalledWith('v1');
    expect(service.listSchemaTables).toHaveBeenCalledWith('v1', 'core', 5, 2);
    expect(service.getSchemaTable).toHaveBeenCalledWith('t1');
    expect(service.listSchemaChangeLog).toHaveBeenCalledWith('pending', 'create', 'u9', 20, 0);
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
});
