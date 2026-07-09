import { BadRequestException, Injectable } from '@nestjs/common';

/**
 * SchemaManagementValidationService
 *
 * Garantías de integridad:
 * ✅ Relaciones (FK) son COMPLETAMENTE INMUTABLES
 * ✅ Columnas críticas (_id, _tenant_id, _created_at) no se editan
 * ✅ Catálogos en uso (usage_count > 0) no se editan
 * ✅ Validación de nombres, tipos, restricciones
 */

@Injectable()
export class SchemaManagementValidationService {
  // Columnas que NUNCA pueden ser editadas una vez creadas
  private readonly IMMUTABLE_COLUMNS = ['_id', '_tenant_id', '_created_at', '_updated_at'];

  // Columnas que siempre deben existir en tablas transaccionales
  private readonly REQUIRED_COLUMNS = ['_id', '_created_at'];

  // Tipos de datos válidos (simplificado)
  private readonly VALID_COLUMN_TYPES = [
    'BIGSERIAL',
    'BIGINT',
    'INTEGER',
    'SMALLINT',
    'VARCHAR',
    'TEXT',
    'BOOLEAN',
    'DATE',
    'TIMESTAMP',
    'TIMESTAMP WITH TIME ZONE',
    'JSONB',
    'UUID',
    'NUMERIC',
    'DECIMAL',
  ];

  /**
   * Validar que una tabla propuesta es válida
   */
  async validateNewTable(data: {
    tableName: string;
    tableType: string;
    columns: Array<{
      columnName: string;
      columnType: string;
      isImmutable?: boolean;
    }>;
    relationships: Array<{
      sourceColumnName: string;
      targetTableName: string;
      targetColumnName: string;
    }>;
  }): Promise<{ valid: true } | { valid: false; errors: string[] }> {
    const errors: string[] = [];

    // Validar nombre de tabla
    if (!/^[a-z][a-z0-9_]*$/.test(data.tableName)) {
      errors.push(
        `Table name must start with lowercase letter, contain only lowercase letters, numbers, underscores. Got: ${data.tableName}`,
      );
    }

    // Validar que no es nombre reservado
    if (this.isReservedTableName(data.tableName)) {
      errors.push(`Table name "${data.tableName}" is reserved`);
    }

    // Validar columnas
    if (!data.columns || data.columns.length === 0) {
      errors.push('At least one column is required');
    } else {
      const columnNames = new Set<string>();

      for (const col of data.columns) {
        // Validar nombre: snake_case; se permite guion bajo inicial para columnas de
        // sistema (_id, _tenant_id, _created_at). Alineado con el schema Zod de entrada.
        if (!/^_?[a-z][a-z0-9_]*$/.test(col.columnName)) {
          errors.push(`Invalid column name: ${col.columnName}`);
        }

        // Validar duplicado
        if (columnNames.has(col.columnName)) {
          errors.push(`Duplicate column name: ${col.columnName}`);
        }
        columnNames.add(col.columnName);

        // Validar tipo
        if (!this.isValidColumnType(col.columnType)) {
          errors.push(`Invalid column type "${col.columnType}". Allowed: ${this.VALID_COLUMN_TYPES.join(', ')}`);
        }

        // Validar que columnas críticas no se marcan como editables
        if (this.IMMUTABLE_COLUMNS.includes(col.columnName) && col.isImmutable === false) {
          errors.push(`Column "${col.columnName}" must be marked as immutable`);
        }
      }

      // Para tablas transaccionales, validar que tiene _id y _created_at
      if (data.tableType === 'transactional') {
        for (const required of this.REQUIRED_COLUMNS) {
          if (!columnNames.has(required)) {
            errors.push(`Transactional table must have "${required}" column. Missing: ${required}`);
          }
        }
      }
    }

    // Validar relaciones: columnas permiten guion bajo inicial (FK típicas apuntan a _id);
    // el nombre de tabla destino NO (las tablas nunca empiezan con guion bajo).
    for (const rel of data.relationships || []) {
      if (!/^_?[a-z][a-z0-9_]*$/.test(rel.sourceColumnName)) {
        errors.push(`Invalid relationship source column: ${rel.sourceColumnName}`);
      }
      if (!/^[a-z][a-z0-9_]*$/.test(rel.targetTableName)) {
        errors.push(`Invalid relationship target table: ${rel.targetTableName}`);
      }
      if (!/^_?[a-z][a-z0-9_]*$/.test(rel.targetColumnName)) {
        errors.push(`Invalid relationship target column: ${rel.targetColumnName}`);
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true };
  }

  /**
   * Validar que NUNCA se intente editar una relación (FK).
   * Los argumentos se conservan (con prefijo _) para mantener la firma del contrato:
   * si en el futuro alguna edición de FK se permitiera bajo flag, la firma no cambia.
   */
  validateRelationshipEdit(_originalTable: { _id: number }, _updateData: Record<string, unknown>): void {
    // Las FK no se pueden editar. Punto.
    throw new BadRequestException(
      'Foreign key relationships cannot be modified. They are immutable. If needed, create a new version of the schema.',
    );
  }

  /**
   * Validar que una columna inmutable no se intente editar
   */
  validateColumnEdit(columnName: string, originalIsImmutable: boolean): void {
    if (this.IMMUTABLE_COLUMNS.includes(columnName) || originalIsImmutable) {
      throw new BadRequestException(
        `Column "${columnName}" is immutable and cannot be modified. It was marked as critical at creation time.`,
      );
    }
  }

  /**
   * Validar que un catálogo que está "en uso" no se edite
   */
  validateCatalogEntryEdit(catalogCode: string, currentUsageCount: number, isImmutableAfterUse: boolean): void {
    if (isImmutableAfterUse && currentUsageCount > 0) {
      throw new BadRequestException(
        `Catalog entry "${catalogCode}" is immutable because it has already been used in ${currentUsageCount} records. ` +
          `Create a new version (${catalogCode}_v2) if changes are needed.`,
      );
    }
  }

  /**
   * Helper: es nombre de tabla reservado?
   */
  private isReservedTableName(tableName: string): boolean {
    const reserved = [
      'schema_versions',
      'schema_tables',
      'schema_columns',
      'schema_relationships',
      'schema_change_log',
      'information_schema',
      'pg_catalog',
      'public',
    ];
    return reserved.includes(tableName.toLowerCase());
  }

  /**
   * Helper: es tipo de dato válido?
   */
  private isValidColumnType(columnType: string): boolean {
    const upperType = columnType.toUpperCase();

    // Búsqueda exacta
    if (this.VALID_COLUMN_TYPES.map((t) => t.toUpperCase()).includes(upperType)) {
      return true;
    }

    // Búsqueda con parámetros VARCHAR(100), NUMERIC(18,2), etc.
    const paramRegex = /^(VARCHAR|CHAR|NUMERIC|DECIMAL|TIMESTAMP)\s*\(\s*\d+\s*(,\s*\d+)?\s*\)$/i;
    if (paramRegex.test(upperType)) {
      return true;
    }

    return false;
  }
}
