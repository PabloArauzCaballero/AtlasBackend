/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business El cliente se entera de que su cuenta quedó verificada sin tener que abrir la app a preguntar.
 * @system siembra las plantillas `customer_lifecycle_active_*` que usa la regla de `customer.lifecycle.active`.
 */
import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

/**
 * `customer.lifecycle.active` se escribe en el outbox desde el 2026-09-26 y ya tiene canales en
 * `notification-rules.service.ts`. Sin plantilla, el orquestador cae a `fallbackText` y el cliente
 * recibiría «Se registró el evento customer.lifecycle.active»: por eso las plantillas van en la misma
 * entrega que la regla.
 *
 * Mientras la identidad se decida por una persona (`IDENTITY_REQUIRE_HUMAN_REVIEW`), pasar a `active` es
 * exactamente «una persona revisó y aprobó tu cuenta», que es lo que dice el texto.
 */
const TITLE = 'Tu cuenta ha sido verificada';
const BODY = 'Revisamos tus datos y tu cuenta de Atlas ya está activa. Ya puedes comprar a cuotas con Atlas.';
const SMS_BODY = 'Atlas: tu cuenta ha sido verificada y ya está activa. Ya puedes comprar a cuotas con Atlas.';

const TEMPLATES: Array<{ channel: string; body: string }> = [
  { channel: 'in_app', body: BODY },
  { channel: 'push', body: BODY },
  { channel: 'email', body: BODY },
  { channel: 'sms', body: SMS_BODY },
];

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  for (const template of TEMPLATES) {
    await queryInterface.sequelize.query(
      `INSERT INTO notification_templates (_tenant_id, code, channel, locale, title_template, subject_template, body_template, payload_schema_json, is_active, version, _created_at, _updated_at)
       SELECT NULL, :code, :channel, 'es-BO', :title, :subject, :body, NULL, true, 1, NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM notification_templates WHERE code = :code AND channel = :channel AND locale = 'es-BO' AND version = 1 AND _tenant_id IS NULL);`,
      {
        replacements: {
          code: `customer_lifecycle_active_${template.channel}`,
          channel: template.channel,
          title: TITLE,
          subject: template.channel === 'email' ? TITLE : null,
          body: template.body,
        },
      },
    );
  }
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(
    `DELETE FROM notification_templates WHERE _tenant_id IS NULL AND version = 1 AND locale = 'es-BO' AND code LIKE 'customer_lifecycle_active_%';`,
  );
}
