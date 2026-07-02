import { DataTypes, QueryInterface } from 'sequelize';

type MigrationContext = {
  context: QueryInterface;
};

async function tableExists(queryInterface: QueryInterface, tableName: string): Promise<boolean> {
  const tables = await queryInterface.showAllTables();
  return tables.map(String).includes(tableName);
}

async function addColumnIfMissing(queryInterface: QueryInterface, tableName: string, columnName: string, spec: object): Promise<void> {
  if (!(await tableExists(queryInterface, tableName))) return;
  const table = await queryInterface.describeTable(tableName);
  if (!(columnName in table)) await queryInterface.addColumn(tableName, columnName, spec as never);
}

async function dropColumnIfExists(queryInterface: QueryInterface, tableName: string, columnName: string): Promise<void> {
  if (!(await tableExists(queryInterface, tableName))) return;
  const table = await queryInterface.describeTable(tableName);
  if (columnName in table) await queryInterface.removeColumn(tableName, columnName);
}

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await addColumnIfMissing(queryInterface, 'notification_messages', 'delivery_targets_json', { type: DataTypes.JSONB, allowNull: true });
  await addColumnIfMissing(queryInterface, 'device_tokens', 'token_encrypted', { type: DataTypes.TEXT, allowNull: true });
  await addColumnIfMissing(queryInterface, 'device_tokens', 'token_last4', { type: DataTypes.STRING(12), allowNull: true });
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await dropColumnIfExists(queryInterface, 'device_tokens', 'token_last4');
  await dropColumnIfExists(queryInterface, 'device_tokens', 'token_encrypted');
  await dropColumnIfExists(queryInterface, 'notification_messages', 'delivery_targets_json');
}
