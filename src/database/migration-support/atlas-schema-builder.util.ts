import { DataTypes, Model, ModelAttributeColumnOptions, ModelAttributes, QueryInterface } from 'sequelize';

/**
 * Utilidades compartidas por migraciones de schema.
 *
 * Este archivo vive fuera de `src/database/migrations/` porque Umzug carga como migración todo
 * archivo `.ts` directo de esa carpeta. Los helpers se importan explícitamente desde
 * `migration-support/` para no exponer archivos sin `up`/`down` al runner.
 */

export type ColumnKind =
  'BIGINT' | 'STRING' | 'TEXT' | 'BOOLEAN' | 'INTEGER' | 'DECIMAL' | 'DATE' | 'DATEONLY' | 'UUID' | 'JSONB' | 'BLOB' | 'INET';

export type ColumnSpec = {
  kind: ColumnKind;
  length?: number;
  precision?: number;
  scale?: number;
  allowNull: boolean;
  primaryKey?: boolean;
  autoIncrement?: boolean;
  comment?: string;
};

export type TableSpec = {
  className: string;
  tableName: string;
  stereotypes: string[];
  columns: Array<{ name: string; spec: ColumnSpec }>;
};

export type ForeignKeySpec = {
  table: string;
  column: string;
  targetTable: string;
  targetColumn: string;
  allowNull: boolean;
};

export type IndexSpec = {
  table: string;
  fields?: string[];
  rawColumns?: string | null;
  where?: string | null;
  unique?: boolean;
  using?: 'gin' | null;
};

export type CheckConstraintSpec = {
  table: string;
  name: string;
  expression: string;
};

export function resolveColumnType(spec: ColumnSpec): ModelAttributeColumnOptions<Model>['type'] {
  switch (spec.kind) {
    case 'BIGINT':
      return DataTypes.BIGINT;
    case 'STRING':
      return DataTypes.STRING(spec.length);
    case 'TEXT':
      return DataTypes.TEXT;
    case 'BOOLEAN':
      return DataTypes.BOOLEAN;
    case 'INTEGER':
      return DataTypes.INTEGER;
    case 'DECIMAL':
      return spec.precision && spec.scale !== undefined ? DataTypes.DECIMAL(spec.precision, spec.scale) : DataTypes.DECIMAL;
    case 'DATE':
      return DataTypes.DATE;
    case 'DATEONLY':
      return DataTypes.DATEONLY;
    case 'UUID':
      return DataTypes.UUID;
    case 'JSONB':
      return DataTypes.JSONB;
    case 'BLOB':
      return DataTypes.BLOB;
    case 'INET':
      return DataTypes.INET;
  }
}

export function buildColumns(table: TableSpec): ModelAttributes<Model> {
  const columns: Record<string, ModelAttributeColumnOptions<Model>> = {};

  for (const column of table.columns) {
    columns[column.name] = {
      type: resolveColumnType(column.spec),
      allowNull: column.spec.allowNull,
    };

    if (column.spec.primaryKey) {
      columns[column.name].primaryKey = true;
    }

    if (column.spec.autoIncrement) {
      columns[column.name].autoIncrement = true;
    }

    if (column.spec.comment) {
      columns[column.name].comment = column.spec.comment;
    }
  }

  return columns as unknown as ModelAttributes<Model>;
}

export function shortenName(name: string): string {
  if (name.length <= 58) {
    return name;
  }

  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }

  return `${name.slice(0, 47)}_${hash.toString(16).padStart(8, '0')}`;
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function indexColumns(index: IndexSpec): string {
  if (index.rawColumns) {
    return index.rawColumns;
  }

  return (index.fields ?? []).map(quoteIdentifier).join(', ');
}

export function indexName(index: IndexSpec): string {
  const raw = index.rawColumns ? index.rawColumns.replace(/[^a-zA-Z0-9]+/g, '_') : (index.fields ?? []).join('_');

  const prefix = index.unique ? 'ux' : 'idx';
  const usingSuffix = index.using ? `_${index.using}` : '';

  return shortenName(`${prefix}_${index.table}_${raw}${usingSuffix}`);
}

async function constraintExists(queryInterface: QueryInterface, tableName: string, constraintName: string): Promise<boolean> {
  const [rows] = (await queryInterface.sequelize.query(
    `
    SELECT EXISTS (
      SELECT 1
        FROM information_schema.table_constraints
       WHERE table_schema = current_schema()
         AND table_name = :tableName
         AND constraint_name = :constraintName
    ) AS "exists";
    `,
    { replacements: { tableName, constraintName } },
  )) as [{ exists: boolean }[], unknown];

  return rows[0]?.exists === true;
}

export async function createIndexes(queryInterface: QueryInterface, indexes: IndexSpec[]): Promise<void> {
  for (const index of indexes) {
    const uniqueSql = index.unique ? 'UNIQUE ' : '';
    const usingSql = index.using ? ` USING ${index.using.toUpperCase()}` : '';
    const whereSql = index.where ? ` WHERE ${index.where}` : '';

    await queryInterface.sequelize.query(
      `CREATE ${uniqueSql}INDEX IF NOT EXISTS ${quoteIdentifier(indexName(index))} ON ${quoteIdentifier(index.table)}${usingSql} (${indexColumns(index)})${whereSql};`,
    );
  }
}

export async function addForeignKeys(queryInterface: QueryInterface, foreignKeys: ForeignKeySpec[]): Promise<void> {
  for (const foreignKey of foreignKeys) {
    const constraintName = shortenName(`fk_${foreignKey.table}_${foreignKey.column}`);

    if (await constraintExists(queryInterface, foreignKey.table, constraintName)) {
      continue;
    }

    await queryInterface.addConstraint(foreignKey.table, {
      fields: [foreignKey.column],
      type: 'foreign key',
      name: constraintName,
      references: {
        table: foreignKey.targetTable,
        field: foreignKey.targetColumn,
      },
      onUpdate: 'CASCADE',
      onDelete: foreignKey.allowNull ? 'SET NULL' : 'RESTRICT',
    });
  }
}

export async function addChecks(queryInterface: QueryInterface, checkConstraints: CheckConstraintSpec[]): Promise<void> {
  for (const constraint of checkConstraints) {
    if (await constraintExists(queryInterface, constraint.table, constraint.name)) {
      continue;
    }

    await queryInterface.sequelize.query(
      `ALTER TABLE ${quoteIdentifier(constraint.table)} ADD CONSTRAINT ${quoteIdentifier(constraint.name)} CHECK (${constraint.expression});`,
    );
  }
}
