import { describe, expect, it, beforeEach } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { SchemaManagementValidationService } from '../../../src/modules/schema-management/services/schema-management-validation.service.js';

/**
 * Fase 4B — tests del validador de schema (código REAL, sin mocks).
 *
 * Cubre las garantías de integridad:
 * - FK inmutables (cualquier edición se rechaza)
 * - Columnas críticas inmutables (_id, _tenant_id, _created_at, _updated_at)
 * - Catálogos en uso congelados (usage_count > 0 + is_immutable_after_use)
 * - Validación de nombres/tipos/columnas requeridas
 */

describe('SchemaManagementValidationService', () => {
  let service: SchemaManagementValidationService;

  beforeEach(() => {
    service = new SchemaManagementValidationService();
  });

  describe('validateNewTable', () => {
    const validTransactionalTable = {
      tableName: 'payment_reversals',
      tableType: 'transactional',
      columns: [
        { columnName: '_id', columnType: 'BIGSERIAL', isImmutable: true },
        { columnName: '_created_at', columnType: 'TIMESTAMP WITH TIME ZONE', isImmutable: true },
        { columnName: 'amount_cents', columnType: 'BIGINT', isImmutable: true },
        { columnName: 'reason', columnType: 'VARCHAR(100)' },
      ],
      relationships: [{ sourceColumnName: 'purchase_id', targetTableName: 'purchases', targetColumnName: '_id' }],
    };

    it('acepta una tabla transaccional válida con FK', async () => {
      const result = await service.validateNewTable(validTransactionalTable);
      expect(result.valid).toBe(true);
    });

    it('rechaza nombre de tabla con mayúsculas', async () => {
      const result = await service.validateNewTable({
        ...validTransactionalTable,
        tableName: 'PaymentReversals',
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.join(' ')).toMatch(/lowercase/i);
      }
    });

    it('rechaza nombres de tabla reservados (schema_versions, etc.)', async () => {
      const result = await service.validateNewTable({
        ...validTransactionalTable,
        tableName: 'schema_change_log',
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.join(' ')).toMatch(/reserved/i);
      }
    });

    it('rechaza tabla sin columnas', async () => {
      const result = await service.validateNewTable({
        ...validTransactionalTable,
        columns: [],
      });
      expect(result.valid).toBe(false);
    });

    it('rechaza columnas duplicadas', async () => {
      const result = await service.validateNewTable({
        ...validTransactionalTable,
        columns: [...validTransactionalTable.columns, { columnName: 'reason', columnType: 'TEXT' }],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.join(' ')).toMatch(/duplicate/i);
      }
    });

    it('rechaza tipo de dato no soportado', async () => {
      const result = await service.validateNewTable({
        ...validTransactionalTable,
        columns: [
          { columnName: '_id', columnType: 'BIGSERIAL', isImmutable: true },
          { columnName: '_created_at', columnType: 'TIMESTAMP WITH TIME ZONE', isImmutable: true },
          { columnName: 'weird', columnType: 'BLOB_MAGIC' },
        ],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.join(' ')).toMatch(/invalid column type/i);
      }
    });

    it('acepta tipos parametrizados VARCHAR(255) y NUMERIC(18,2)', async () => {
      const result = await service.validateNewTable({
        ...validTransactionalTable,
        columns: [
          { columnName: '_id', columnType: 'BIGSERIAL', isImmutable: true },
          { columnName: '_created_at', columnType: 'TIMESTAMP WITH TIME ZONE', isImmutable: true },
          { columnName: 'email', columnType: 'VARCHAR(255)' },
          { columnName: 'balance', columnType: 'NUMERIC(18,2)' },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('exige _id en tablas transaccionales', async () => {
      const result = await service.validateNewTable({
        ...validTransactionalTable,
        columns: [
          { columnName: '_created_at', columnType: 'TIMESTAMP WITH TIME ZONE', isImmutable: true },
          { columnName: 'reason', columnType: 'TEXT' },
        ],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.join(' ')).toContain('_id');
      }
    });

    it('exige _created_at en tablas transaccionales', async () => {
      const result = await service.validateNewTable({
        ...validTransactionalTable,
        columns: [
          { columnName: '_id', columnType: 'BIGSERIAL', isImmutable: true },
          { columnName: 'reason', columnType: 'TEXT' },
        ],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.join(' ')).toContain('_created_at');
      }
    });

    it('NO exige _created_at en tablas catalog', async () => {
      const result = await service.validateNewTable({
        tableName: 'my_lookup_codes',
        tableType: 'catalog',
        columns: [{ columnName: 'code', columnType: 'VARCHAR(50)' }],
        relationships: [],
      });
      expect(result.valid).toBe(true);
    });

    it('rechaza columna crítica marcada explícitamente como NO inmutable', async () => {
      const result = await service.validateNewTable({
        ...validTransactionalTable,
        columns: [
          { columnName: '_id', columnType: 'BIGSERIAL', isImmutable: false },
          { columnName: '_created_at', columnType: 'TIMESTAMP WITH TIME ZONE', isImmutable: true },
        ],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.join(' ')).toMatch(/immutable/i);
      }
    });

    it('rechaza relaciones con nombres inválidos', async () => {
      const result = await service.validateNewTable({
        ...validTransactionalTable,
        relationships: [{ sourceColumnName: 'x;DROP TABLE', targetTableName: 'purchases', targetColumnName: '_id' }],
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('validateRelationshipEdit — FK son inmutables SIEMPRE', () => {
    it('lanza BadRequestException ante cualquier intento de editar FK', () => {
      expect(() => service.validateRelationshipEdit({ _id: 1 }, { targetTableId: 99 })).toThrow(BadRequestException);
    });

    it('el mensaje explica que las FK son inmutables', () => {
      expect(() => service.validateRelationshipEdit({ _id: 1 }, {})).toThrow(/immutable/i);
    });
  });

  describe('validateColumnEdit — columnas críticas inmutables', () => {
    it.each(['_id', '_tenant_id', '_created_at', '_updated_at'])('rechaza editar %s', (col) => {
      expect(() => service.validateColumnEdit(col, false)).toThrow(BadRequestException);
    });

    it('rechaza editar cualquier columna marcada isImmutable=true', () => {
      expect(() => service.validateColumnEdit('score_at_origination', true)).toThrow(BadRequestException);
    });

    it('permite editar columnas normales no inmutables', () => {
      expect(() => service.validateColumnEdit('description', false)).not.toThrow();
    });
  });

  describe('validateCatalogEntryEdit — catálogos en uso congelados', () => {
    it('rechaza editar catálogo en uso con is_immutable_after_use=true', () => {
      expect(() => service.validateCatalogEntryEdit('risk_band_excellent', 5, true)).toThrow(BadRequestException);
    });

    it('el error sugiere crear nueva versión (_v2)', () => {
      expect(() => service.validateCatalogEntryEdit('risk_band_excellent', 1, true)).toThrow(/risk_band_excellent_v2/);
    });

    it('permite editar catálogo sin uso (usage_count=0)', () => {
      expect(() => service.validateCatalogEntryEdit('risk_band_excellent', 0, true)).not.toThrow();
    });

    it('permite editar catálogo mutable aunque esté en uso', () => {
      expect(() => service.validateCatalogEntryEdit('city_zones', 10, false)).not.toThrow();
    });
  });
});
