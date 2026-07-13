import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

/**
 * Metadata para que un futuro frontend pueda agrupar/etiquetar notificaciones (categoría + ícono)
 * en vez de solo tener título/cuerpo en texto plano. `category` distingue el origen semántico de
 * la notificación (ej. `system_alert`, `billing`, `kyc`, `custom_broadcast`) y `icon` es un
 * identificador de ícono libre (el frontend decide el mapeo ícono -> asset).
 *
 * Se agrega tanto a `notification_templates` (la plantilla define el default) como a
 * `notification_messages` (el mensaje ya creado congela category/icon en el momento del envío,
 * para que cambios posteriores a la plantilla no reescriban el historial).
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE notification_templates
  ADD COLUMN IF NOT EXISTS category VARCHAR(60),
  ADD COLUMN IF NOT EXISTS icon VARCHAR(60);

ALTER TABLE notification_messages
  ADD COLUMN IF NOT EXISTS category VARCHAR(60),
  ADD COLUMN IF NOT EXISTS icon VARCHAR(60);

CREATE INDEX IF NOT EXISTS ix_notification_messages_category ON notification_messages(category);
`);
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
DROP INDEX IF EXISTS ix_notification_messages_category;
ALTER TABLE notification_messages
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS icon;
ALTER TABLE notification_templates
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS icon;
`);
}
