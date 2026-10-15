import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { asyncMock, type AsyncMock } from '../../support/jest-mocks.js';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SchemaManagementService } from '../../../src/modules/schema-management/services/schema-management.service.js';
import { SchemaManagementValidationService } from '../../../src/modules/schema-management/services/schema-management-validation.service.js';
import type { SchemaChangeLogRow } from '../../../src/modules/schema-management/schema-management.rows.js';
import type { SchemaChangeLogRepository } from '../../../src/modules/schema-management/schema-change-log.repository.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';

/**
 * Fase 4B — tests del servicio principal (código REAL con repo mockeado).
 *
 * Cubre las decisiones de robustez a largo plazo:
 * - 403 Forbidden (no 401) para roles insuficientes
 * - Principio de 4 ojos: el proponente no puede aprobar su propio cambio
 * - Lock pesimista dentro de transacción al aprobar
 * - Conflict 409 si el cambio ya fue resuelto
 * - Requiere un actor identificado en el token (platformUserId o internalUserId)
 * - Sesión interna (hallazgo A4): propone y aprueba con el permiso fino, sin rol platform_admin
 */

/** Doble de `SchemaChangeLogRepository`: la auditoría de propuestas, con su lock pesimista. */
type RepoMock = {
  [K in keyof SchemaChangeLogRepository]: AsyncMock;
};

function makeRepoMock(): RepoMock {
  return {
    createChangeLogEntry: asyncMock(),
    getChangeLogEntry: asyncMock(),
    getChangeLogEntryForUpdate: asyncMock(),
    listChangeLog: asyncMock(),
    resolveChangeLogEntry: asyncMock(),
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

/**
 * Sesiones INTERNAS como las emite el portal: sólo `internalUserId`, y el rol que da
 * `legacyRoleForInternalRoles` (DATA_GOVERNANCE_MANAGER → admin). El permiso fino ya lo decidió
 * `SchemaChangeAuthorizationGuard` (ver su spec); aquí se prueba qué registra el servicio.
 */
const internalProposer: AuthenticatedUser = { sub: 'i-7', role: 'admin', tenantId: '1', internalUserId: '7' };
const internalApprover: AuthenticatedUser = { sub: 'i-8', role: 'admin', tenantId: '1', internalUserId: '8' };

const customerUser: AuthenticatedUser = {
  sub: 'u-cust',
  role: 'customer',
  customerId: '1',
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
    requester_internal_user_id: null,
    approval_status: 'pending',
    approved_by_platform_user_id: null,
    approved_by_internal_user_id: null,
    approved_at: null,
    approval_notes: null,
    rolled_back: false,
    change_result: 'pending',
    error_message: null,
    applied_by_migration: null,
    applied_at: null,
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
    /*
     * La auditoría de propuestas vive ahora en `SchemaChangeLogRepository`. Se le pasa el MISMO
     * doble: el reparto de métodos entre los dos repositorios es un detalle de organización, y estas
     * pruebas describen el comportamiento del servicio, no dónde está cada consulta.
     */
    service = new SchemaManagementService(repo as unknown as SchemaChangeLogRepository, new SchemaManagementValidationService());
  });

  // =========================================================================
  // Proponer
  // =========================================================================

  describe('proposeNewTable', () => {
    it('rechaza con 403 Forbidden a roles no autorizados (customer)', async () => {
      await expect(service.proposeNewTable(validProposal, customerUser)).rejects.toThrow(ForbiddenException);
      expect(repo.createChangeLogEntry).not.toHaveBeenCalled();
    });

    it('rechaza si el token no trae ni platformUserId ni internalUserId (no hay a quién auditar)', async () => {
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

    it('A4: un usuario INTERNO propone y queda registrado como proponente interno', async () => {
      repo.createChangeLogEntry.mockResolvedValue(makePendingChange({ requester_platform_user_id: null, requester_internal_user_id: '7' }));

      const dto = await service.proposeNewTable(validProposal, internalProposer);

      const input = repo.createChangeLogEntry.mock.calls[0]?.[0] as {
        requesterPlatformUserId: string | null;
        requesterInternalUserId: string | null;
      };
      expect(input.requesterInternalUserId).toBe('7');
      expect(input.requesterPlatformUserId).toBeNull();
      expect(dto.requesterInternalUserId).toBe('7');
      expect(dto.requesterPlatformUserId).toBeNull();
    });
  });

  // =========================================================================
  // Aprobar / rechazar
  // =========================================================================

  describe('approveSchemaChange', () => {
    it('sesión de PLATAFORMA: rechaza con 403 a internal_operator (sólo platform_admin aprueba)', async () => {
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

  describe('approveSchemaChange con sesión interna (A4)', () => {
    const internalChange = () => makePendingChange({ requester_platform_user_id: null, requester_internal_user_id: '7' });

    it('otro usuario interno aprueba sin rol platform_admin y queda registrado como aprobador interno', async () => {
      repo.getChangeLogEntryForUpdate.mockResolvedValue(internalChange());
      repo.resolveChangeLogEntry.mockResolvedValue(
        makePendingChange({
          requester_platform_user_id: null,
          requester_internal_user_id: '7',
          approval_status: 'approved',
          approved_by_internal_user_id: '8',
          change_result: 'success',
          approved_at: new Date(),
        }),
      );

      const result = await service.approveSchemaChange('100', { approval: 'approve' }, internalApprover);

      expect(result.approvalStatus).toBe('approved');
      const input = repo.resolveChangeLogEntry.mock.calls[0]?.[1] as {
        approvedByInternalUserId: string | null;
        approvedByPlatformUserId: string | null;
      };
      expect(input.approvedByInternalUserId).toBe('8');
      expect(input.approvedByPlatformUserId).toBeNull();
    });

    it('CUATRO OJOS: el usuario interno que propuso no puede aprobar', async () => {
      repo.getChangeLogEntryForUpdate.mockResolvedValue(internalChange());
      await expect(service.approveSchemaChange('100', { approval: 'approve' }, internalProposer)).rejects.toThrow('Segregation of duties');
      expect(repo.resolveChangeLogEntry).not.toHaveBeenCalled();
    });

    it('el mismo id en otra población NO es la misma persona (interno 10 ≠ plataforma 10)', async () => {
      repo.getChangeLogEntryForUpdate.mockResolvedValue(makePendingChange({ requester_platform_user_id: '10' }));
      repo.resolveChangeLogEntry.mockResolvedValue(makePendingChange({ approval_status: 'approved', approved_at: new Date() }));
      const internalTen: AuthenticatedUser = { sub: 'i-10', role: 'admin', tenantId: '1', internalUserId: '10' };

      await expect(service.approveSchemaChange('100', { approval: 'approve' }, internalTen)).resolves.toMatchObject({
        approvalStatus: 'approved',
      });
    });
  });

  // =========================================================================
  // Change log
  // =========================================================================

  describe('listSchemaChangeLog', () => {
    it('pasa filtros al repositorio y mapea filas a DTOs', async () => {
      repo.listChangeLog.mockResolvedValue({ rows: [makePendingChange()], total: 1 });

      const result = await service.listSchemaChangeLog(
        { approvalStatus: 'pending', changeType: 'CREATE_TABLE', requesterUserId: '10' },
        50,
        0,
      );

      expect(repo.listChangeLog).toHaveBeenCalledWith(
        { approvalStatus: 'pending', changeType: 'CREATE_TABLE', requesterUserId: '10' },
        50,
        0,
      );
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]?.approvalStatus).toBe('pending');
      expect(result.changes[0]?.requesterPlatformUserId).toBe('10');
    });
  });
});
