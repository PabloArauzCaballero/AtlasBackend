/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Operaciones se entera de que un caso de soporte está por incumplir (o incumplió) su plazo, con un texto que dice qué caso y cuánto falta.
 * @system siembra las plantillas `support_sla_warning_in_app` y `support_sla_breached_in_app` que usan las reglas de `notification-rules.service.ts`.
 */
import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

/**
 * `support.sla.warning` y `support.sla.breached` tienen regla `operations`/`in_app` desde el
 * 2026-09-29 (antes el primero no se publicaba y el segundo no tenía canales). Sin plantilla, el
 * orquestador cae a `fallbackText` y el aviso diría «Se registró el evento support.sla.warning»: por
 * eso las plantillas van en la misma entrega que la regla. Sólo bandeja interna: un aviso de plazo no
 * sale de la casa.
 *
 * Variables del payload: `caseId`, `metricType`, `targetAt`, `reachedPercent` y `minutesRemaining`
 * (esta última sólo en el aviso previo).
 */
const TEMPLATES: Array<{ code: string; title: string; body: string }> = [
  {
    code: 'support_sla_warning_in_app',
    title: 'Un caso de soporte está por incumplir su plazo',
    body: 'El caso {{caseId}} ya consumió el {{reachedPercent}} % de su plazo ({{metricType}}) y quedan unos {{minutesRemaining}} minutos. Atiéndelo antes de que venza.',
  },
  {
    code: 'support_sla_breached_in_app',
    title: 'Un caso de soporte incumplió su plazo',
    body: 'El caso {{caseId}} venció su plazo ({{metricType}}); el objetivo era {{targetAt}}. Sigue abierto: atiéndelo cuanto antes.',
  },
];

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  for (const template of TEMPLATES) {
    await queryInterface.sequelize.query(
      `INSERT INTO notification_templates (_tenant_id, code, channel, locale, title_template, subject_template, body_template, payload_schema_json, is_active, version, _created_at, _updated_at)
       SELECT NULL, :code, 'in_app', 'es-BO', :title, NULL, :body, NULL, true, 1, NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM notification_templates WHERE code = :code AND channel = 'in_app' AND locale = 'es-BO' AND version = 1 AND _tenant_id IS NULL);`,
      { replacements: template },
    );
  }
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(
    `DELETE FROM notification_templates WHERE _tenant_id IS NULL AND version = 1 AND locale = 'es-BO' AND channel = 'in_app' AND code IN ('support_sla_warning_in_app', 'support_sla_breached_in_app');`,
  );
}
