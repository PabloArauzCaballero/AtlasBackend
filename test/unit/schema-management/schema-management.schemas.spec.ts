import { describe, expect, it } from '@jest/globals';
import {
  approveSchemaChangeRequestSchema,
  createSchemaTableRequestSchema,
  schemaChangeLogQuerySchema,
  schemaTablesListQuerySchema,
  schemaVersionsListQuerySchema,
} from '../../../src/modules/schema-management/schema-management.schemas.js';

/**
 * Fase 4B — tests de los schemas Zod REALES (primera barrera de entrada HTTP).
 *
 * Cubre:
 * - Coerción de query params (HTTP entrega strings: "20", "true")
 * - Defensa contra inyección en identificadores SQL
 * - Regla de auditoría: rechazar exige approvalNotes
 * - .strict(): campos extra se rechazan (no se cuelan payloads inesperados)
 */

describe('schema-management Zod schemas', () => {
  // =========================================================================
  // schemaVersionsListQuerySchema
  // =========================================================================

  describe('schemaVersionsListQuerySchema', () => {
    it('coerce de strings HTTP a números y booleans', () => {
      const parsed = schemaVersionsListQuerySchema.parse({
        limit: '25',
        offset: '10',
        includeInactive: 'true',
      });
      expect(parsed.limit).toBe(25);
      expect(parsed.offset).toBe(10);
      expect(parsed.includeInactive).toBe(true);
    });

    it('aplica defaults cuando no vienen params', () => {
      const parsed = schemaVersionsListQuerySchema.parse({});
      expect(parsed.limit).toBe(20);
      expect(parsed.offset).toBe(0);
      expect(parsed.includeInactive).toBe(false);
    });

    it('rechaza limit fuera de rango (max 100)', () => {
      expect(() => schemaVersionsListQuerySchema.parse({ limit: '5000' })).toThrow();
    });

    it('rechaza campos extra (.strict)', () => {
      expect(() => schemaVersionsListQuerySchema.parse({ evil: '1' })).toThrow();
    });
  });

  // =========================================================================
  // schemaTablesListQuerySchema
  // =========================================================================

  describe('schemaTablesListQuerySchema', () => {
    it('acepta versionId numérico como string', () => {
      const parsed = schemaTablesListQuerySchema.parse({ versionId: '1' });
      expect(parsed.versionId).toBe('1');
    });

    it('rechaza versionId no numérico (defensa de inyección en id)', () => {
      expect(() => schemaTablesListQuerySchema.parse({ versionId: '1; DROP TABLE customers' })).toThrow();
    });

    it('rechaza tableType fuera del enum', () => {
      expect(() => schemaTablesListQuerySchema.parse({ versionId: '1', tableType: 'weird' })).toThrow();
    });
  });

  // =========================================================================
  // createSchemaTableRequestSchema
  // =========================================================================

  describe('createSchemaTableRequestSchema', () => {
    const validBody = {
      tableName: 'payment_reversals',
      tableType: 'transactional',
      columns: [
        { columnName: '_id', columnType: 'BIGSERIAL', isImmutable: true },
        { columnName: '_created_at', columnType: 'TIMESTAMP WITH TIME ZONE', isImmutable: true },
      ],
      justification: 'Fraud reversal workflow tracking',
    };

    it('acepta propuesta válida y aplica defaults', () => {
      const parsed = createSchemaTableRequestSchema.parse(validBody);
      expect(parsed.isAppendOnly).toBe(false);
      expect(parsed.isTenantScoped).toBe(true);
      expect(parsed.relationships).toEqual([]);
    });

    it('acepta columnas con guion bajo inicial (_id, _created_at)', () => {
      const parsed = createSchemaTableRequestSchema.parse(validBody);
      expect(parsed.columns[0]?.columnName).toBe('_id');
    });

    it('rechaza tableName con intento de inyección', () => {
      expect(() =>
        createSchemaTableRequestSchema.parse({
          ...validBody,
          tableName: 'x"; DROP TABLE customers; --',
        }),
      ).toThrow();
    });

    it('rechaza tableName con mayúsculas', () => {
      expect(() => createSchemaTableRequestSchema.parse({ ...validBody, tableName: 'PaymentReversals' })).toThrow();
    });

    it('rechaza justification demasiado corta (auditoría exige razón)', () => {
      expect(() => createSchemaTableRequestSchema.parse({ ...validBody, justification: 'test' })).toThrow();
    });

    it('rechaza tabla sin columnas', () => {
      expect(() => createSchemaTableRequestSchema.parse({ ...validBody, columns: [] })).toThrow();
    });

    it('rechaza más de 200 columnas', () => {
      const columns = Array.from({ length: 201 }, (_, i) => ({
        columnName: `col_${i}`,
        columnType: 'TEXT',
      }));
      expect(() => createSchemaTableRequestSchema.parse({ ...validBody, columns })).toThrow();
    });

    it('rechaza relaciones con targetTableName inválido', () => {
      expect(() =>
        createSchemaTableRequestSchema.parse({
          ...validBody,
          relationships: [
            {
              sourceColumnName: 'purchase_id',
              targetTableName: 'purchases; --',
              targetColumnName: '_id',
            },
          ],
        }),
      ).toThrow();
    });

    it('rechaza campos extra dentro de columnas (.strict anidado)', () => {
      expect(() =>
        createSchemaTableRequestSchema.parse({
          ...validBody,
          columns: [
            { columnName: '_id', columnType: 'BIGSERIAL', isImmutable: true, sneaky: true },
            {
              columnName: '_created_at',
              columnType: 'TIMESTAMP WITH TIME ZONE',
              isImmutable: true,
            },
          ],
        }),
      ).toThrow();
    });
  });

  // =========================================================================
  // schemaChangeLogQuerySchema
  // =========================================================================

  describe('schemaChangeLogQuerySchema', () => {
    it('acepta filtros válidos', () => {
      const parsed = schemaChangeLogQuerySchema.parse({
        approvalStatus: 'pending',
        changeType: 'CREATE_TABLE',
        requesterUserId: '10',
        limit: '10',
      });
      expect(parsed.approvalStatus).toBe('pending');
      expect(parsed.changeType).toBe('CREATE_TABLE');
      expect(parsed.limit).toBe(10);
    });

    it('rechaza changeType que no sea UPPER_SNAKE_CASE', () => {
      expect(() => schemaChangeLogQuerySchema.parse({ changeType: 'create-table; --' })).toThrow();
    });

    it('rechaza requesterUserId no numérico', () => {
      expect(() => schemaChangeLogQuerySchema.parse({ requesterUserId: 'abc' })).toThrow();
    });
  });

  // =========================================================================
  // approveSchemaChangeRequestSchema
  // =========================================================================

  describe('approveSchemaChangeRequestSchema', () => {
    it('acepta aprobación sin notas', () => {
      const parsed = approveSchemaChangeRequestSchema.parse({ approval: 'approve' });
      expect(parsed.approval).toBe('approve');
    });

    it('acepta aprobación con notas', () => {
      const parsed = approveSchemaChangeRequestSchema.parse({
        approval: 'approve',
        approvalNotes: 'Reviewed against RFD-123',
      });
      expect(parsed.approvalNotes).toBe('Reviewed against RFD-123');
    });

    it('REGLA DE AUDITORÍA: rechazar SIN notas es inválido', () => {
      expect(() => approveSchemaChangeRequestSchema.parse({ approval: 'reject' })).toThrow(/approvalNotes is required/);
    });

    it('rechazar CON notas es válido', () => {
      const parsed = approveSchemaChangeRequestSchema.parse({
        approval: 'reject',
        approvalNotes: 'Missing compliance FK',
      });
      expect(parsed.approval).toBe('reject');
    });

    it('rechaza valores fuera del enum approve/reject', () => {
      expect(() => approveSchemaChangeRequestSchema.parse({ approval: 'maybe' })).toThrow();
    });
  });
});
