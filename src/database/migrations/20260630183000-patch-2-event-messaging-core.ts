import { DataTypes, QueryInterface } from 'sequelize';

type MigrationContext = {
  context: QueryInterface;
};

type ColumnSpec = {
  type: unknown;
  allowNull?: boolean;
  defaultValue?: unknown;
};

async function tableExists(queryInterface: QueryInterface, tableName: string): Promise<boolean> {
  const tables = await queryInterface.showAllTables();
  return tables.map(String).includes(tableName);
}

async function addColumnIfMissing(queryInterface: QueryInterface, tableName: string, columnName: string, spec: ColumnSpec): Promise<void> {
  const table = await queryInterface.describeTable(tableName);
  if (!(columnName in table)) {
    await queryInterface.addColumn(tableName, columnName, spec as never);
  }
}

async function dropColumnIfExists(queryInterface: QueryInterface, tableName: string, columnName: string): Promise<void> {
  if (!(await tableExists(queryInterface, tableName))) return;
  const table = await queryInterface.describeTable(tableName);
  if (columnName in table) {
    await queryInterface.removeColumn(tableName, columnName);
  }
}

async function createIndexIfMissing(queryInterface: QueryInterface, tableName: string, fields: string[], name: string): Promise<void> {
  const indexes = (await queryInterface.showIndex(tableName)) as Array<{ name: string }>;
  if (!indexes.some((index: { name: string }) => index.name === name)) {
    await queryInterface.addIndex(tableName, fields, { name });
  }
}

const defaultTemplates = [
  ['user_registered_in_app', 'in_app', 'Bienvenido a ATLAS', 'Tu cuenta fue creada correctamente.'],
  ['user_registered_email', 'email', 'Bienvenido a ATLAS', 'Tu cuenta fue creada correctamente. Completa tu perfil para continuar.'],
  ['kyc_approved_in_app', 'in_app', 'Verificación aprobada', 'Tu verificación fue aprobada.'],
  ['kyc_rejected_email', 'email', 'Verificación pendiente', 'No pudimos aprobar tu verificación con la información enviada.'],
  ['credit_line_approved_in_app', 'in_app', 'Línea aprobada', 'Tu línea de crédito fue aprobada.'],
  [
    'credit_line_approved_email',
    'email',
    'Tu línea fue aprobada',
    'Tu línea de crédito fue aprobada. Revisa la app para ver los siguientes pasos.',
  ],
  [
    'credit_line_rejected_email',
    'email',
    'Resultado de evaluación',
    'Por ahora no podemos aprobar tu línea. Te avisaremos si puedes volver a intentarlo.',
  ],
  ['purchase_created_in_app', 'in_app', 'Compra iniciada', 'Tu compra fue registrada.'],
  ['purchase_awaiting_downpayment_in_app', 'in_app', 'Pago inicial pendiente', 'Completa el pago inicial para continuar con tu compra.'],
  ['purchase_expired_email', 'email', 'Compra expirada', 'Tu compra expiró porque no se completó el pago inicial a tiempo.'],
  ['installment_due_soon_in_app', 'in_app', 'Cuota próxima', 'Tienes una cuota próxima a vencer.'],
  ['installment_due_soon_email', 'email', 'Recordatorio de cuota', 'Tienes una cuota próxima a vencer. Revisa el detalle en la app.'],
  ['installment_due_today_in_app', 'in_app', 'Cuota vence hoy', 'Tu cuota vence hoy.'],
  ['installment_overdue_in_app', 'in_app', 'Cuota vencida', 'Tienes una cuota vencida.'],
  ['installment_overdue_email', 'email', 'Cuota vencida', 'Tienes una cuota vencida. Revisa el detalle en la app.'],
  ['payment_confirmed_in_app', 'in_app', 'Pago confirmado', 'Tu pago fue confirmado.'],
  ['merchant_settlement_ready_email', 'email', 'Liquidación lista', 'Tu liquidación está lista para revisión.'],
  ['risk_alert_created_in_app', 'in_app', 'Alerta de riesgo', 'Se generó una alerta de riesgo para revisión operativa.'],
];

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  if (await tableExists(queryInterface, 'outbox_events')) {
    await addColumnIfMissing(queryInterface, 'outbox_events', 'event_family', { type: DataTypes.STRING(80), allowNull: true });
    await addColumnIfMissing(queryInterface, 'outbox_events', 'event_version', {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 1,
    });
    await addColumnIfMissing(queryInterface, 'outbox_events', 'metadata_json', { type: DataTypes.JSONB, allowNull: true });
    await addColumnIfMissing(queryInterface, 'outbox_events', 'priority', { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 });
    await addColumnIfMissing(queryInterface, 'outbox_events', 'max_attempts', {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 3,
    });
    await addColumnIfMissing(queryInterface, 'outbox_events', 'locked_at', { type: DataTypes.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, 'outbox_events', 'locked_by', { type: DataTypes.STRING(120), allowNull: true });
    await addColumnIfMissing(queryInterface, 'outbox_events', 'failed_at', { type: DataTypes.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, 'outbox_events', 'error_code', { type: DataTypes.STRING(120), allowNull: true });
    await addColumnIfMissing(queryInterface, 'outbox_events', 'idempotency_key', { type: DataTypes.STRING(180), allowNull: true });
    await addColumnIfMissing(queryInterface, 'outbox_events', 'causation_id', { type: DataTypes.STRING(120), allowNull: true });
    await addColumnIfMissing(queryInterface, 'outbox_events', 'source_module', { type: DataTypes.STRING(120), allowNull: true });
    await addColumnIfMissing(queryInterface, 'outbox_events', 'source_action', { type: DataTypes.STRING(120), allowNull: true });

    await createIndexIfMissing(
      queryInterface,
      'outbox_events',
      ['status', 'priority', 'available_at'],
      'ix_outbox_status_priority_available_at',
    );
    await createIndexIfMissing(queryInterface, 'outbox_events', ['event_code'], 'ix_outbox_event_code');
    await createIndexIfMissing(queryInterface, 'outbox_events', ['correlation_id'], 'ix_outbox_correlation_id');
    await createIndexIfMissing(queryInterface, 'outbox_events', ['idempotency_key'], 'ix_outbox_idempotency_key');
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_outbox_tenant_event_idempotency_key ON outbox_events (_tenant_id, event_code, idempotency_key) WHERE idempotency_key IS NOT NULL;`,
    );
  }

  if (!(await tableExists(queryInterface, 'notification_templates'))) {
    await queryInterface.createTable('notification_templates', {
      _id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
      _tenant_id: { type: DataTypes.BIGINT, allowNull: true },
      code: { type: DataTypes.STRING(160), allowNull: false },
      channel: { type: DataTypes.STRING(40), allowNull: false },
      locale: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'es-BO' },
      title_template: { type: DataTypes.TEXT, allowNull: true },
      subject_template: { type: DataTypes.TEXT, allowNull: true },
      body_template: { type: DataTypes.TEXT, allowNull: false },
      payload_schema_json: { type: DataTypes.JSONB, allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      _created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      _updated_at: { type: DataTypes.DATE, allowNull: true },
    });
    await createIndexIfMissing(
      queryInterface,
      'notification_templates',
      ['_tenant_id', 'code', 'channel', 'locale', 'version'],
      'ix_notification_templates_lookup',
    );
    await createIndexIfMissing(queryInterface, 'notification_templates', ['code'], 'ix_notification_templates_code');
    await createIndexIfMissing(queryInterface, 'notification_templates', ['channel'], 'ix_notification_templates_channel');
    await createIndexIfMissing(queryInterface, 'notification_templates', ['is_active'], 'ix_notification_templates_active');
  }

  if (!(await tableExists(queryInterface, 'notification_messages'))) {
    await queryInterface.createTable('notification_messages', {
      _id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
      _tenant_id: { type: DataTypes.BIGINT, allowNull: true },
      outbox_event_id: { type: DataTypes.BIGINT, allowNull: true },
      recipient_type: { type: DataTypes.STRING(40), allowNull: false },
      recipient_id: { type: DataTypes.STRING(120), allowNull: false },
      channel: { type: DataTypes.STRING(40), allowNull: false },
      template_code: { type: DataTypes.STRING(160), allowNull: true },
      subject: { type: DataTypes.TEXT, allowNull: true },
      title: { type: DataTypes.TEXT, allowNull: true },
      body: { type: DataTypes.TEXT, allowNull: false },
      payload_json: { type: DataTypes.JSONB, allowNull: true },
      delivery_targets_json: { type: DataTypes.JSONB, allowNull: true },
      status: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'pending' },
      priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      scheduled_at: { type: DataTypes.DATE, allowNull: true },
      queued_at: { type: DataTypes.DATE, allowNull: true },
      sent_at: { type: DataTypes.DATE, allowNull: true },
      delivered_at: { type: DataTypes.DATE, allowNull: true },
      read_at: { type: DataTypes.DATE, allowNull: true },
      failed_at: { type: DataTypes.DATE, allowNull: true },
      cancelled_at: { type: DataTypes.DATE, allowNull: true },
      idempotency_key: { type: DataTypes.STRING(180), allowNull: true },
      correlation_id: { type: DataTypes.STRING(120), allowNull: true },
      causation_id: { type: DataTypes.STRING(120), allowNull: true },
      _created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      _updated_at: { type: DataTypes.DATE, allowNull: true },
    });
    await createIndexIfMissing(
      queryInterface,
      'notification_messages',
      ['_tenant_id', 'recipient_type', 'recipient_id', 'status'],
      'ix_notification_messages_recipient_status',
    );
    await createIndexIfMissing(
      queryInterface,
      'notification_messages',
      ['status', 'scheduled_at'],
      'ix_notification_messages_status_scheduled',
    );
    await createIndexIfMissing(queryInterface, 'notification_messages', ['outbox_event_id'], 'ix_notification_messages_outbox_event');
    await createIndexIfMissing(queryInterface, 'notification_messages', ['idempotency_key'], 'ix_notification_messages_idempotency_key');
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_messages_idempotency_key ON notification_messages (_tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;`,
    );
  }

  if (!(await tableExists(queryInterface, 'notification_deliveries'))) {
    await queryInterface.createTable('notification_deliveries', {
      _id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
      _tenant_id: { type: DataTypes.BIGINT, allowNull: true },
      notification_message_id: { type: DataTypes.BIGINT, allowNull: false },
      channel: { type: DataTypes.STRING(40), allowNull: false },
      provider: { type: DataTypes.STRING(80), allowNull: false },
      provider_message_id: { type: DataTypes.STRING(180), allowNull: true },
      status: { type: DataTypes.STRING(40), allowNull: false },
      attempt_number: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      error_code: { type: DataTypes.STRING(120), allowNull: true },
      error_message: { type: DataTypes.TEXT, allowNull: true },
      request_payload_json: { type: DataTypes.JSONB, allowNull: true },
      response_payload_json: { type: DataTypes.JSONB, allowNull: true },
      sent_at: { type: DataTypes.DATE, allowNull: true },
      delivered_at: { type: DataTypes.DATE, allowNull: true },
      failed_at: { type: DataTypes.DATE, allowNull: true },
      _created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    await createIndexIfMissing(
      queryInterface,
      'notification_deliveries',
      ['notification_message_id'],
      'ix_notification_deliveries_message',
    );
    await createIndexIfMissing(
      queryInterface,
      'notification_deliveries',
      ['channel', 'provider', 'status'],
      'ix_notification_deliveries_channel_provider_status',
    );
  }

  if (!(await tableExists(queryInterface, 'user_notification_preferences'))) {
    await queryInterface.createTable('user_notification_preferences', {
      _id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
      _tenant_id: { type: DataTypes.BIGINT, allowNull: false },
      customer_id: { type: DataTypes.BIGINT, allowNull: false },
      event_code: { type: DataTypes.STRING(160), allowNull: false },
      channel: { type: DataTypes.STRING(40), allowNull: false },
      is_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      is_required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      _created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      _updated_at: { type: DataTypes.DATE, allowNull: true },
    });
    await queryInterface.addIndex('user_notification_preferences', ['_tenant_id', 'customer_id', 'event_code', 'channel'], {
      name: 'ux_user_notification_preferences_lookup',
      unique: true,
    });
  }

  if (!(await tableExists(queryInterface, 'device_tokens'))) {
    await queryInterface.createTable('device_tokens', {
      _id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
      _tenant_id: { type: DataTypes.BIGINT, allowNull: false },
      customer_id: { type: DataTypes.BIGINT, allowNull: false },
      platform: { type: DataTypes.STRING(40), allowNull: false },
      token_hash: { type: DataTypes.STRING(128), allowNull: false },
      token_encrypted: { type: DataTypes.TEXT, allowNull: true },
      token_last4: { type: DataTypes.STRING(12), allowNull: true },
      device_id: { type: DataTypes.STRING(180), allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      last_seen_at: { type: DataTypes.DATE, allowNull: true },
      _created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      _updated_at: { type: DataTypes.DATE, allowNull: true },
    });
    await queryInterface.addIndex('device_tokens', ['_tenant_id', 'customer_id', 'platform', 'token_hash'], {
      name: 'ux_device_tokens_customer_platform_hash',
      unique: true,
    });
    await createIndexIfMissing(
      queryInterface,
      'device_tokens',
      ['_tenant_id', 'customer_id', 'is_active'],
      'ix_device_tokens_customer_active',
    );
  }

  const rows = defaultTemplates.map(([code, channel, title, body]) => ({
    _tenant_id: null,
    code,
    channel,
    locale: 'es-BO',
    title_template: title,
    subject_template: channel === 'email' ? title : null,
    body_template: body,
    payload_schema_json: null,
    is_active: true,
    version: 1,
    _created_at: new Date(),
    _updated_at: new Date(),
  }));
  for (const row of rows) {
    await queryInterface.sequelize.query(
      `INSERT INTO notification_templates (_tenant_id, code, channel, locale, title_template, subject_template, body_template, payload_schema_json, is_active, version, _created_at, _updated_at)
       SELECT :tenantId, :code, :channel, :locale, :titleTemplate, :subjectTemplate, :bodyTemplate, NULL, :isActive, :version, :createdAt, :updatedAt
       WHERE NOT EXISTS (SELECT 1 FROM notification_templates WHERE code = :code AND channel = :channel AND locale = :locale AND version = :version AND _tenant_id IS NULL);`,
      {
        replacements: {
          tenantId: row._tenant_id,
          code: row.code,
          channel: row.channel,
          locale: row.locale,
          titleTemplate: row.title_template,
          subjectTemplate: row.subject_template,
          bodyTemplate: row.body_template,
          isActive: row.is_active,
          version: row.version,
          createdAt: row._created_at,
          updatedAt: row._updated_at,
        },
      },
    );
  }
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.dropTable('device_tokens');
  await queryInterface.dropTable('user_notification_preferences');
  await queryInterface.dropTable('notification_deliveries');
  await queryInterface.dropTable('notification_messages');
  await queryInterface.dropTable('notification_templates');

  await queryInterface.sequelize.query('DROP INDEX IF EXISTS ux_outbox_tenant_event_idempotency_key;');
  await dropColumnIfExists(queryInterface, 'outbox_events', 'source_action');
  await dropColumnIfExists(queryInterface, 'outbox_events', 'source_module');
  await dropColumnIfExists(queryInterface, 'outbox_events', 'causation_id');
  await dropColumnIfExists(queryInterface, 'outbox_events', 'idempotency_key');
  await dropColumnIfExists(queryInterface, 'outbox_events', 'error_code');
  await dropColumnIfExists(queryInterface, 'outbox_events', 'failed_at');
  await dropColumnIfExists(queryInterface, 'outbox_events', 'locked_by');
  await dropColumnIfExists(queryInterface, 'outbox_events', 'locked_at');
  await dropColumnIfExists(queryInterface, 'outbox_events', 'max_attempts');
  await dropColumnIfExists(queryInterface, 'outbox_events', 'priority');
  await dropColumnIfExists(queryInterface, 'outbox_events', 'metadata_json');
  await dropColumnIfExists(queryInterface, 'outbox_events', 'event_version');
  await dropColumnIfExists(queryInterface, 'outbox_events', 'event_family');
}
