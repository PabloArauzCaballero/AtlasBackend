import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE system_data_relationship_catalog
      ALTER COLUMN optionality TYPE VARCHAR(60);
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE system_data_relationship_catalog
      ALTER COLUMN optionality TYPE VARCHAR(40);
  `);
}
