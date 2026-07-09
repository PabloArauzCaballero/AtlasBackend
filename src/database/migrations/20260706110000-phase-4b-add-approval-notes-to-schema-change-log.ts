import { QueryInterface } from 'sequelize';

/**
 * Fase 4B: agrega approval_notes a schema_change_log.
 *
 * Por qué migración nueva y no editar la 20260706070000: la regla del proyecto
 * (CONTRIBUTING.md §5) prohíbe editar migraciones que pudieron haberse aplicado
 * ya en ambientes compartidos. Esta columna guarda la justificación del aprobador
 * al aprobar/rechazar un cambio DDL, exigida por el flujo de auditoría de Fase 4B.
 */

type MigrationContext = { context: QueryInterface };

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE schema_change_log
    ADD COLUMN IF NOT EXISTS approval_notes TEXT;
  `);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
    ALTER TABLE schema_change_log
    DROP COLUMN IF EXISTS approval_notes;
  `);
}
