import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SchemaManagementService } from '../../../src/modules/schema-management/services/schema-management.service.js';
import { SchemaManagementValidationService } from '../../../src/modules/schema-management/services/schema-management-validation.service.js';
import type {
  SchemaChangeLogRow,
  SchemaManagementRepository,
  SchemaVersionRow,
} from '../../../src/modules/schema-management/schema-management.repository.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';

/**
 * Fase 4B — tests del servicio principal (código REAL con repo mockeado).
 *
 * Cubre las decisiones de robustez a largo plazo:
 * - 403 Forbidden (no 401) para roles insuficientes
 * - Principio de 4 ojos: el proponente no puede aprobar su propio cambio
 * - Lock pesimista dentro de transacción al aprobar
 * - Conflict 409 si el cambio ya fue resuelto
 * - Requiere platformUserId en el token
 */

type RepoMock = {
  [K in keyof SchemaManagementRepository]: jest.Mock;
};

function makeRepoMock(): RepoMock {
  return {
    getSchemaVersion: jest.fn(),
    listSchemaVersions: jest.fn(),
    countTablesInVersion: jest.fn(async () => 0),
    countColumnsInVersion: jest.fn(async () => 0),
    countRelationshipsInVersion: jest.fn(async () => 0),
    countTablesColumnsRelationshipsForVersions: jest.fn(async () => new Map()),
    getSchemaTable: jest.fn(),
    listSchemaTables: jest.fn(),
    getSchemaColumns: jest.fn(async () => []),
    getSchemaRelationshipsForTable: jest.fn(async () => []),
    createChangeLogEntry: jest.fn(),
    getChangeLogEntry: jest.fn(),
    getChangeLogEntryForUpdate: jest.fn(),
    listChangeLog: jest.fn(),
    resolveChangeLogEntry: jest.fn(),
    // withTransaction real-ish: ejecuta el callback con un token de transacción falso
    withTransaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({ id: 'tx-1' })),
  } as unknown as RepoMock;
}

const operatorUser: AuthenticatedUser = {
  sub: 'u-op',
  role: 'internal_operator',
  platformUserId: '10',
};

const adminUser: AuthenticatedUser = {
  sub: 'u-admin',
  role: 'platform_admin',
  platformUserId: '20',
};

const customerUser: AuthenticatedUser = {
  sub: 'u-cust',
  role: 'customer',
  customerId: '1',
};

const baseVersionRow: SchemaVersionRow = {
  _id: '1',
  version_code: 'v1.0',
  created_by_platform_user_id: null,
  created_at: new Date('2026-07-06T00:00:00Z'),
  notes: 'Initial',
  is_active: true,
  parent_version_id: null,
};

function makePendingChange(overrides: Partial<SchemaChangeLogRow> = {}): SchemaChangeLogRow {
  return {
    _id: '100',
    schema_version_id: null,
    change_type: 'CREATE_TABLE',
    affected_entity_id: null,
    affected_entity_type: 'TABLE',
    change_payload: { tableName: 'payment_reversals' },
    requester_platform_user_id: '10',
    approval_status: 'pending',
    approved_by_platform_user_id: null,
    approved_at: null,
    approval_notes: null,
    rolled_back: false,
    change_result: 'pending',
    error_message: null,
    created_at: new Date('2026-07-06T01:00:00Z'),
    ...overrides,
  };
}

const validProposal = {
  tableName: 'payment_reversals',
  tableType: 'transactional' as const,
  isAppendOnly: false,
  isTenantScoped: true,
  description: 'Reversal tracking',
  columns: [
    {
      columnName: '_id',
      columnType: 'BIGSERIAL',
      isNullable: false,
      isImmutable: true,
      isPii: false,
      isIndexed: true,
    },
    {
      columnName: '_created_at',
      columnType: 'TIMESTAMP WITH TIME ZONE',
      isNullable: false,
      isImmutable: true,
      isPii: false,
      isIndexed: false,
    },
  ],
  relationships: [],
  justification: 'Needed for fraud reversal workflow tracking',
};

describe('SchemaManagementService', () => {
  let repo: RepoMock;
  let service: SchemaManagementService;

  beforeEach(() => {
    repo = makeRepoMock();
    service = new SchemaManagementService(repo as unknown as SchemaManagementRepository, new SchemaManagementValidationService());
  });

  // =========================================================================
  // Lectura
  // =========================================================================

  describe('listSchemaVersions', () => {
    it('devuelve versiones con conteos reales de tablas/columnas/FK', async () => {
      repo.listSchemaVersions.mockResolvedValue({ rows: [baseVersionRow], total: 1 });
      repo.countTablesColumnsRelationshipsForVersions.mockResolvedValue(
        new Map([['1', { tablesCount: 121, columnsCount: 900, relationshipsCount: 140 }]]),
      );

      const result = await service.listSchemaVersions(20, 0, false);

      expect(result.total).toBe(1);
      expect(result.versions[0]?.versionCode).toBe('v1.0');
      expect(result.versions[0]?.tablesCount).toBe(121);
      expect(result.versions[0]?.columnsCount).toBe(900);
      expect(result.versions[0]?.relationshipsCount).toBe(140);
    });

    it('fetches counts for the whole page in a single batch call, not 3 COUNT(*) per version (N+1 regression)', async () => {
      const rows = [
        { ...baseVersionRow, _id: '1' },
        { ...baseVersionRow, _id: '2' },
        { ...baseVersionRow, _id: '3' },
      ];
      repo.listSchemaVersions.mockResolvedValue({ rows, total: 3 });

      await service.listSchemaVersions(20, 0, false);

      expect(repo.countTablesColumnsRelationshipsForVersions).toHaveBeenCalledTimes(1);
      expect(repo.countTablesColumnsRelationshipsForVersions).toHaveBeenCalledWith(['1', '2', '3']);
      expect(repo.countTablesInVersion).not.toHaveBeenCalled();
      expect(repo.countColumnsInVersion).not.toHaveBeenCalled();
      expect(repo.countRelationshipsInVersion).not.toHaveBeenCalled();
    });

    it('defaults counts to 0 for a version missing from the batch map', async () => {
      repo.listSchemaVersions.mockResolvedValue({ rows: [baseVersionRow], total: 1 });
      repo.countTablesColumnsRelationshipsForVersions.mockResolvedValue(new Map());

      const result = await service.listSchemaVersions(20, 0, false);

      expect(result.versions[0]).toMatchObject({ tablesCount: 0, columnsCount: 0, relationshipsCount: 0 });
    });
  });

  describe('getSchemaVersion', () => {
    it('lanza NotFound si la versión no existe', async () => {
      repo.getSchemaVersion.mockResolvedValue(null);
      await expect(service.getSchemaVersion('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listSchemaTables', () => {
    it('lanza NotFound si la versión no existe (no lista tablas de versiones fantasma)', async () => {
      repo.getSchemaVersion.mockResolvedValue(null);
      await expect(service.listSchemaTables('999', undefined, 50, 0)).rejects.toThrow(NotFoundException);
      expect(repo.listSchemaTables).not.toHaveBeenCalled();
    });
  });

  describe('getSchemaTable', () => {
    it('lanza NotFound si la tabla no existe', async () => {
      repo.getSchemaTable.mockResolvedValue(null);
      await expect(service.getSchemaTable('999')).rejects.toThrow(NotFoundException);
    });

    it('incluye columnas y relaciones con FK marcadas inmutables', async () => {
      repo.getSchemaTable.mockResolvedValue({
        _id: '5',
        schema_version_id: '1',
        table_name: 'purchases',
        table_type: 'transactional',
        is_append_only: true,
        is_tenant_scoped: true,
        description: null,
        created_at: new Date(),
        is_deleted: false,
      });
      repo.getSchemaColumns.mockResolvedValue([
        {
          _id: '50',
          schema_table_id: '5',
          column_name: '_id',
          column_type: 'BIGSERIAL',
          is_nullable: false,
          is_immutable: true,
          is_pii: false,
          is_indexed: true,
          default_value: null,
          description: null,
          is_deleted: false,
        },
      ]);
      repo.getSchemaRelationshipsForTable.mockResolvedValue([
        {
          _id: '70',
          schema_version_id: '1',
          source_table_id: '5',
          source_column_name: 'customer_id',
          target_table_id: '2',
          target_table_name: 'customers',
          target_column_name: '_id',
          cascade_delete: false,
          is_immutable: true,
        },
      ]);

      const dto = await service.getSchemaTable('5');

      expect(dto.columns).toHaveLength(1);
      expect(dto.relationships).toHaveLength(1);
      expect(dto.relationships?.[0]?.isImmutable).toBe(true);
      expect(dto.relationships?.[0]?.targetTableName).toBe('customers');
    });
  });

  // =========================================================================
  // Proponer
  // =========================================================================

  describe('proposeNewTable', () => {
    it('rechaza con 403 Forbidden a roles no autorizados (customer)', async () => {
      await expect(service.proposeNewTable(validProposal, customerUser)).rejects.toThrow(ForbiddenException);
      expect(repo.createChangeLogEntry).not.toHaveBeenCalled();
    });

    it('rechaza si el token no trae platformUserId (no hay a quién auditar)', async () => {
      const noIdOperator: AuthenticatedUser = { sub: 'x', role: 'internal_operator' };
      await expect(service.proposeNewTable(validProposal, noIdOperator)).rejects.toThrow(ForbiddenException);
    });

    it('rechaza propuestas inválidas ANTES de escribir en change log', async () => {
      const invalid = { ...validProposal, tableName: 'schema_versions' };
      await expect(service.proposeNewTable(invalid, operatorUser)).rejects.toThrow(BadRequestException);
      expect(repo.createChangeLogEntry).not.toHaveBeenCalled();
    });

    it('crea entry pending con payload completo y requester correcto', async () => {
      repo.createChangeLogEntry.mockResolvedValue(makePendingChange());

      const dto = await service.proposeNewTable(validProposal, operatorUser);

      expect(dto.approvalStatus).toBe('pending');
      const input = repo.createChangeLogEntry.mock.calls[0]?.[0] as {
        changeType: string;
        requesterPlatformUserId: string;
        changePayload: Record<string, unknown>;
      };
      expect(input.changeType).toBe('CREATE_TABLE');
      expect(input.requesterPlatformUserId).toBe('10');
      expect(input.changePayload.tableName).toBe('payment_reversals');
      expect(input.changePayload.justification).toBeTruthy();
    });
  });

  // =========================================================================
  // Aprobar / rechazar
  // =========================================================================

  describe('approveSchemaChange', () => {
    it('rechaza con 403 a internal_operator (solo platform_admin aprueba)', async () => {
      await expect(service.approveSchemaChange('100', { approval: 'approve' }, operatorUser)).rejects.toThrow(ForbiddenException);
      expect(repo.withTransaction).not.toHaveBeenCalled();
    });

    it('usa lock pesimista (getChangeLogEntryForUpdate) dentro de transacción', async () => {
      repo.getChangeLogEntryForUpdate.mockResolvedValue(makePendingChange());
      repo.resolveChangeLogEntry.mockResolvedValue(
        makePendingChange({ approval_status: 'approved', change_result: 'success', approved_at: new Date() }),
      );

      await service.approveSchemaChange('100', { approval: 'approve' }, adminUser);

      expect(repo.withTransaction).toHaveBeenCalledTimes(1);
      expect(repo.getChangeLogEntryForUpdate).toHaveBeenCalledWith('100', { id: 'tx-1' });
    });

    it('lanza NotFound si el cambio no existe', async () => {
      repo.getChangeLogEntryForUpdate.mockResolvedValue(null);
      await expect(service.approveSchemaChange('999', { approval: 'approve' }, adminUser)).rejects.toThrow(NotFoundException);
    });

    it('lanza Conflict 409 si el cambio ya fue resuelto (evita doble ejecución)', async () => {
      repo.getChangeLogEntryForUpdate.mockResolvedValue(makePendingChange({ approval_status: 'approved' }));
      await expect(service.approveSchemaChange('100', { approval: 'approve' }, adminUser)).rejects.toThrow(ConflictException);
      expect(repo.resolveChangeLogEntry).not.toHaveBeenCalled();
    });

    it('PRINCIPIO DE 4 OJOS: el proponente no puede aprobar su propio cambio', async () => {
      // El cambio fue propuesto por platformUserId '20' — el mismo adminUser
      repo.getChangeLogEntryForUpdate.mockResolvedValue(makePendingChange({ requester_platform_user_id: '20' }));
      await expect(service.approveSchemaChange('100', { approval: 'approve' }, adminUser)).rejects.toThrow(ForbiddenException);
      expect(repo.resolveChangeLogEntry).not.toHaveBeenCalled();
    });

    it('aprueba correctamente cuando aprobador ≠ proponente', async () => {
      repo.getChangeLogEntryForUpdate.mockResolvedValue(makePendingChange({ requester_platform_user_id: '10' }));
      repo.resolveChangeLogEntry.mockResolvedValue(
        makePendingChange({
          approval_status: 'approved',
          approved_by_platform_user_id: '20',
          change_result: 'success',
          approved_at: new Date(),
        }),
      );

      const result = await service.approveSchemaChange('100', { approval: 'approve' }, adminUser);

      expect(result.approvalStatus).toBe('approved');
      expect(result.changeResult).toBe('success');
      const resolveInput = repo.resolveChangeLogEntry.mock.calls[0]?.[1] as {
        approvedByPlatformUserId: string;
        approvalStatus: string;
      };
      expect(resolveInput.approvedByPlatformUserId).toBe('20');
      expect(resolveInput.approvalStatus).toBe('approved');
    });

    it('rechaza correctamente guardando notas de auditoría', async () => {
      repo.getChangeLogEntryForUpdate.mockResolvedValue(makePendingChange());
      repo.resolveChangeLogEntry.mockResolvedValue(
        makePendingChange({
          approval_status: 'rejected',
          approval_notes: 'Missing FK to compliance table',
          change_result: 'rejected',
          approved_at: new Date(),
        }),
      );

      const result = await service.approveSchemaChange(
        '100',
        { approval: 'reject', approvalNotes: 'Missing FK to compliance table' },
        adminUser,
      );

      expect(result.approvalStatus).toBe('rejected');
      const resolveInput = repo.resolveChangeLogEntry.mock.calls[0]?.[1] as {
        approvalNotes: string | null;
        changeResult: string;
      };
      expect(resolveInput.approvalNotes).toBe('Missing FK to compliance table');
      expect(resolveInput.changeResult).toBe('rejected');
    });
  });

  // =========================================================================
  // Change log
  // =========================================================================

  describe('listSchemaChangeLog', () => {
    it('pasa filtros al repositorio y mapea filas a DTOs', async () => {
      repo.listChangeLog.mockResolvedValue({ rows: [makePendingChange()], total: 1 });

      const result = await service.listSchemaChangeLog('pending', 'CREATE_TABLE', '10', 50, 0);

      expect(repo.listChangeLog).toHaveBeenCalledWith('pending', 'CREATE_TABLE', '10', 50, 0);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]?.approvalStatus).toBe('pending');
      expect(result.changes[0]?.requesterPlatformUserId).toBe('10');
    });
  });
});
