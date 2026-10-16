/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business El cliente se entera cuando algo suyo ya está hecho: su capacidad, su extracto, su compra, su pago.
 * @system siembra las plantillas de los avisos del mapa de 2026-10-16 y corrige las que salían con el texto de respaldo.
 */
import { QueryInterface } from 'sequelize';

type MigrationContext = { context: QueryInterface };

/**
 * Pablo (2026-10-16): «cuando algo ya esté hecho, mandemos una notificación: tu capacidad fue actualizada, tu
 * cuenta ha sido verificada…». Mapa completo en `docs/notifications/mapa-de-avisos-al-cliente.md`.
 *
 * Cada regla de `notification-rules.service.ts` necesita su plantilla por canal: sin ella el orquestador cae a
 * `fallbackText` y el cliente lee «Se registró el evento payment.confirmed». Medido en TEST el 2026-10-16:
 * `payment.confirmed` (push, correo), `payment.rejected` (todo), `payment.reported` y `kyc.rejected` (bandeja)
 * no tenían plantilla.
 *
 * Reglas del texto: el PUSH no lleva cifras ni motivos (se lee en la pantalla bloqueada); la BANDEJA sí, porque
 * sólo la ve el dueño con la sesión abierta. `{{…}}` se rellena con el payload del evento.
 */
type Plantilla = { code: string; channel: 'in_app' | 'push' | 'email'; category: string; title: string; body: string };

const P = (code: string, channel: Plantilla['channel'], category: string, title: string, body: string): Plantilla => ({
  code: `${code}_${channel}`,
  channel,
  category,
  title,
  body,
});

const PLANTILLAS: Plantilla[] = [
  // Línea de crédito que cambia fuera de un extracto.
  P(
    'credit_line_created',
    'in_app',
    'credit',
    'Tu línea de crédito está lista',
    'Ya tienes una línea de Bs {{newLimitText}} para comprar a cuotas.',
  ),
  P('credit_line_created', 'push', 'credit', 'Tu línea de crédito está lista', 'Ya puedes comprar a cuotas. Toca para ver tu línea.'),
  P('credit_line_increased', 'in_app', 'credit', 'Tu capacidad fue actualizada', 'Tu línea de crédito subió a Bs {{newLimitText}}.'),
  P('credit_line_increased', 'push', 'credit', 'Tu capacidad fue actualizada', 'Tu línea de crédito subió. Toca para verla.'),
  P(
    'credit_line_decreased',
    'in_app',
    'credit',
    'Tu línea de crédito cambió',
    'Recalculamos tu línea y ahora es de Bs {{newLimitText}}. En la app ves por qué y cómo hacerla subir.',
  ),
  P('credit_line_decreased', 'push', 'credit', 'Tu línea de crédito cambió', 'Recalculamos tu línea de crédito. Toca para ver el detalle.'),
  // Extracto bancario.
  P(
    'bank_statement_applied',
    'in_app',
    'credit',
    'Tu capacidad fue actualizada',
    'Leímos tu extracto y recalculamos tu línea: ahora es de Bs {{newLimitText}}.',
  ),
  P(
    'bank_statement_applied',
    'push',
    'credit',
    'Tu capacidad fue actualizada',
    'Leímos tu extracto y actualizamos tu capacidad de pago. Toca para ver tu línea.',
  ),
  P(
    'bank_statement_line_held',
    'in_app',
    'credit',
    'Leímos tu extracto',
    'Tu capacidad de pago ya quedó medida. Una persona del equipo confirma tu nueva línea y te avisamos.',
  ),
  P('bank_statement_line_held', 'push', 'credit', 'Leímos tu extracto', 'Una persona del equipo confirma tu nueva línea. Te avisamos.'),
  P('bank_statement_rejected', 'in_app', 'credit', 'No pudimos usar tu extracto', '{{reason}}'),
  P('bank_statement_rejected', 'push', 'credit', 'No pudimos usar tu extracto', 'Toca para ver qué pasó y cómo resolverlo.'),
  P(
    'bank_statement_in_review',
    'in_app',
    'credit',
    'Tu extracto está en revisión',
    'Una persona lo está revisando. No necesitas hacer nada: te avisamos al terminar.',
  ),
  // Compras que decidió una persona.
  P(
    'credit_application_approved',
    'in_app',
    'credit',
    'Tu compra fue aprobada',
    'Revisamos tu solicitud de compra y fue aprobada. Toca para ver el detalle.',
  ),
  P(
    'credit_application_approved',
    'push',
    'credit',
    'Tu compra fue aprobada',
    'Revisamos tu solicitud de compra. Toca para ver el detalle.',
  ),
  P(
    'credit_application_rejected',
    'in_app',
    'credit',
    'No pudimos aprobar tu compra',
    'Revisamos tu solicitud de compra y esta vez no fue aprobada. Toca para ver el motivo y qué puedes hacer.',
  ),
  P('credit_application_rejected', 'push', 'credit', 'Tu solicitud de compra', 'Revisamos tu solicitud. Toca para ver el resultado.'),
  // Identidad rechazada: hoy sólo había correo.
  P('kyc_rejected', 'in_app', 'onboarding', 'No pudimos verificar tu identidad', 'Revisa en la app qué falta y vuelve a intentarlo.'),
  P('kyc_rejected', 'push', 'onboarding', 'No pudimos verificar tu identidad', 'Toca para ver qué falta.'),
  // Pagos: salían con el texto de respaldo.
  P(
    'payment_reported',
    'in_app',
    'payment',
    'Recibimos tu aviso de pago',
    'El comercio revisa tu pago de Bs {{amount}}. Te avisamos cuando lo confirme.',
  ),
  P('payment_confirmed', 'push', 'payment', 'Tu pago fue confirmado', 'Ya quedó registrado. Toca para ver tus pagos.'),
  P('payment_confirmed', 'email', 'payment', 'Tu pago fue confirmado', 'Tu pago de Bs {{amount}} ya quedó registrado en tu cuota.'),
  P(
    'payment_rejected',
    'in_app',
    'payment',
    'No pudimos confirmar tu pago',
    'El comercio no pudo verificar tu pago de Bs {{amount}}. Toca para ver qué hacer.',
  ),
  P('payment_rejected', 'push', 'payment', 'No pudimos confirmar tu pago', 'Toca para ver qué hacer.'),
  P(
    'payment_rejected',
    'email',
    'payment',
    'No pudimos confirmar tu pago',
    'El comercio no pudo verificar tu pago de Bs {{amount}}. Entra a la app para ver qué hacer.',
  ),
];

/** Textos que ya existían y se leían a sistema: se reescriben (el `down` restaura los anteriores). */
const REESCRITAS: Array<{ code: string; title: string; body: string; category: string; before: { title: string; body: string } }> = [
  {
    code: 'kyc_approved_in_app',
    title: 'Verificamos tu identidad',
    body: 'Tu carnet y tu foto quedaron verificados. Te avisamos cuando tu cuenta esté activa.',
    category: 'onboarding',
    before: { title: 'Verificación aprobada', body: 'Tu verificación fue aprobada.' },
  },
];

/** Las de «tu cuenta ha sido verificada» no tenían categoría: la bandeja las pintaba como un sobre gris. */
const CATEGORIA_ONBOARDING = ['customer_lifecycle_active_in_app', 'customer_lifecycle_active_push', 'customer_lifecycle_active_email'];

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  for (const p of PLANTILLAS) {
    await queryInterface.sequelize.query(
      `INSERT INTO notification_templates (_tenant_id, code, channel, locale, title_template, subject_template, body_template, payload_schema_json, is_active, version, category, _created_at, _updated_at)
       SELECT NULL, :code, :channel, 'es-BO', :title, :subject, :body, NULL, true, 1, :category, NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM notification_templates WHERE code = :code AND channel = :channel AND locale = 'es-BO' AND version = 1 AND _tenant_id IS NULL);`,
      {
        replacements: {
          code: p.code,
          channel: p.channel,
          title: p.title,
          subject: p.channel === 'email' ? p.title : null,
          body: p.body,
          category: p.category,
        },
      },
    );
  }
  for (const r of REESCRITAS) {
    await queryInterface.sequelize.query(
      `UPDATE notification_templates SET title_template = :title, body_template = :body, category = :category, _updated_at = NOW()
       WHERE code = :code AND locale = 'es-BO' AND version = 1 AND _tenant_id IS NULL;`,
      { replacements: { code: r.code, title: r.title, body: r.body, category: r.category } },
    );
  }
  await queryInterface.sequelize.query(
    `UPDATE notification_templates SET category = 'onboarding', _updated_at = NOW()
     WHERE code IN (:codes) AND _tenant_id IS NULL AND category IS NULL;`,
    { replacements: { codes: CATEGORIA_ONBOARDING } },
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(
    `DELETE FROM notification_templates WHERE _tenant_id IS NULL AND version = 1 AND locale = 'es-BO' AND code IN (:codes);`,
    { replacements: { codes: PLANTILLAS.map((p) => p.code) } },
  );
  for (const r of REESCRITAS) {
    await queryInterface.sequelize.query(
      `UPDATE notification_templates SET title_template = :title, body_template = :body, category = NULL, _updated_at = NOW()
       WHERE code = :code AND locale = 'es-BO' AND version = 1 AND _tenant_id IS NULL;`,
      { replacements: { code: r.code, title: r.before.title, body: r.before.body } },
    );
  }
  await queryInterface.sequelize.query(
    `UPDATE notification_templates SET category = NULL, _updated_at = NOW() WHERE code IN (:codes) AND _tenant_id IS NULL AND category = 'onboarding';`,
    { replacements: { codes: CATEGORIA_ONBOARDING } },
  );
}
