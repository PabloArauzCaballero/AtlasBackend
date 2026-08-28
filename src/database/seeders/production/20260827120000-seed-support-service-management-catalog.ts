/**
 * @file Seeder idempotente: instala datos de referencia o fixtures del perfil.
 * @business Deja escrito qué colas de soporte existen, cómo se clasifica y qué se promete al atender.
 * @system siembra colas, taxonomía, políticas de SLA, respuestas rápidas y clases de retención.
 */
import { QueryInterface, QueryTypes } from 'sequelize';
import { atlasSchemaFor } from '../../domain-schemas.js';

type SeedContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('support_queues');
const QUEUES = `${SCHEMA}.support_queues`;
const CATEGORIES = `${SCHEMA}.support_case_categories`;
const SLA = `${SCHEMA}.support_sla_policies`;
const CANNED = `${SCHEMA}.support_canned_responses`;
const RETENTION = `${atlasSchemaFor('retention_policies')}.retention_policies`;

const POLICY_CODE = 'atlas_support_default';

/**
 * Este catálogo es de PRODUCCIÓN, no de demostración.
 *
 * Sin él, el motor de soporte arranca sin colas, sin taxonomía y sin ninguna promesa escrita: un
 * caso no se puede clasificar, no se puede enrutar y no se puede medir. No siembra ninguna persona,
 * ningún caso ni ninguna conversación — sólo las reglas con las que después se atenderá.
 *
 * ## Los plazos son un PUNTO DE PARTIDA que Atlas debe aprobar
 *
 * Ni ISO/IEC 20000-1 ni ITIL imponen minutos concretos: los fija cada organización según su
 * capacidad real. Los de aquí son una propuesta conservadora y explícita, que se cambia publicando
 * la versión 2 de la política —no editando estas filas—, para que los casos ya abiertos se sigan
 * midiendo con lo que se les prometió.
 */
const SLA_POLICIES = [
  {
    priority: 'P1',
    calendar_kind: '24x7',
    acknowledge: 5,
    first_response: 5,
    update_interval: 30,
    resolution: 240,
    pause_customer: false,
    pause_partner: false,
  },
  {
    priority: 'P2',
    calendar_kind: '24x7',
    acknowledge: 10,
    first_response: 15,
    update_interval: 60,
    resolution: 480,
    pause_customer: true,
    pause_partner: true,
  },
  {
    priority: 'P3',
    calendar_kind: 'business_hours',
    acknowledge: 60,
    first_response: 240,
    update_interval: 480,
    resolution: 1440,
    pause_customer: true,
    pause_partner: true,
  },
  {
    priority: 'P4',
    calendar_kind: 'business_hours',
    acknowledge: 240,
    first_response: 480,
    update_interval: 960,
    resolution: 2400,
    pause_customer: true,
    pause_partner: true,
  },
];

/** Horario laboral boliviano por defecto. Se guarda con la política, no en el código del servidor. */
const BUSINESS_HOURS = { weekdays: [1, 2, 3, 4, 5], startMinute: 510, endMinute: 1080, holidays: [] as string[] };

const QUEUE_ROWS = [
  {
    code: 'consumer_l1',
    name: 'Consumidores · Primer nivel',
    context: 'CONSUMER',
    skills: ['CONSUMER_SUPPORT'],
    priority: 'P3',
    order: 10,
    description: 'Primera atención al cliente final: consultas, guía de uso y recolección de evidencia.',
  },
  {
    code: 'consumer_l2',
    name: 'Consumidores · Segundo nivel',
    context: 'CONSUMER',
    skills: ['CONSUMER_SUPPORT', 'AUTH'],
    priority: 'P2',
    order: 20,
    description: 'Problemas técnicos que el primer nivel no puede reproducir ni resolver.',
  },
  {
    code: 'partner_l1',
    name: 'Comercios · Primer nivel',
    context: 'PARTNER_USER',
    skills: ['PARTNER_SUPPORT'],
    priority: 'P3',
    order: 30,
    description: 'Atención al usuario del portal de negocio: alta, QR, ventas y reportes.',
  },
  {
    code: 'partner_operations',
    name: 'Comercios · Operaciones',
    context: 'PARTNER_USER',
    skills: ['PARTNER_SUPPORT', 'RECONCILIATION'],
    priority: 'P2',
    order: 40,
    description: 'Conciliación, liquidaciones y facturación de comisiones del comercio.',
  },
  {
    code: 'credit_specialist',
    name: 'Riesgo y crédito',
    context: 'CONSUMER',
    skills: ['CREDIT'],
    priority: 'P3',
    order: 50,
    description: 'Explicación de decisiones de crédito. No modifica decisiones: las explica y documenta.',
  },
  {
    code: 'security_fraud',
    name: 'Seguridad y fraude',
    context: 'CONSUMER',
    skills: ['SECURITY', 'FRAUD'],
    priority: 'P1',
    order: 60,
    description: 'Toma de cuenta, phishing, sospecha de fraude y exposición de datos.',
  },
  {
    code: 'privacy',
    name: 'Privacidad y datos',
    context: 'CONSUMER',
    skills: ['PRIVACY'],
    priority: 'P2',
    order: 70,
    description: 'Solicitudes sobre datos personales y ejercicio de derechos.',
  },
  {
    code: 'complaints',
    name: 'Reclamos formales',
    context: 'CONSUMER',
    skills: ['CONSUMER_SUPPORT'],
    priority: 'P2',
    order: 80,
    description: 'Reclamos formales de clientes y comercios, con tratamiento propio y sin cierre automático.',
  },
];

/**
 * La taxonomía inicial, en dos niveles.
 *
 * Los códigos raíz agrupan por dominio y los hijos son el motivo concreto que se enruta. La
 * sensibilidad viaja con la categoría porque se conoce antes que el contenido: un caso de fraude
 * nace restringido aunque todavía nadie haya escrito una línea en él.
 */
const CATEGORY_ROWS = [
  { code: 'AUTH', parent: null, domain: 'AUTH', label: 'Acceso a mi cuenta', type: 'ACCOUNT_ACCESS', queue: 'consumer_l1', sensitivity: 'NORMAL', audience: 'CONSUMER', urgency: 'HIGH', order: 10 },
  { code: 'AUTH_OTP_NOT_RECEIVED', parent: 'AUTH', domain: 'AUTH', label: 'No recibo el código de verificación', type: 'ACCOUNT_ACCESS', queue: 'consumer_l1', sensitivity: 'NORMAL', audience: 'CONSUMER', urgency: 'HIGH', order: 11 },
  { code: 'AUTH_ACCOUNT_TAKEOVER', parent: 'AUTH', domain: 'SECURITY', label: 'Creo que alguien entró a mi cuenta', type: 'SECURITY_INCIDENT', queue: 'security_fraud', sensitivity: 'RESTRICTED', audience: 'CONSUMER', urgency: 'CRITICAL', order: 12 },
  { code: 'PAYMENT', parent: null, domain: 'PAYMENT', label: 'Pagos y comprobantes', type: 'PAYMENT_EVIDENCE', queue: 'consumer_l1', sensitivity: 'NORMAL', audience: 'CONSUMER', urgency: 'NORMAL', order: 20 },
  { code: 'PAYMENT_PROOF_NOT_RECOGNIZED', parent: 'PAYMENT', domain: 'PAYMENT', label: 'Pagué y no me lo reconocen', type: 'PAYMENT_EVIDENCE', queue: 'consumer_l1', sensitivity: 'NORMAL', audience: 'CONSUMER', urgency: 'HIGH', order: 21 },
  { code: 'PAYMENT_DUPLICATED', parent: 'PAYMENT', domain: 'PAYMENT', label: 'Me cobraron dos veces', type: 'COMPLAINT', queue: 'complaints', sensitivity: 'SENSITIVE', audience: 'CONSUMER', urgency: 'HIGH', order: 22 },
  { code: 'INSTALLMENTS', parent: null, domain: 'INSTALLMENTS', label: 'Mis cuotas', type: 'QUESTION', queue: 'consumer_l1', sensitivity: 'NORMAL', audience: 'CONSUMER', urgency: 'NORMAL', order: 30 },
  { code: 'CREDIT_DECISION', parent: null, domain: 'CREDIT', label: 'Mi evaluación de crédito', type: 'CREDIT_DECISION_EXPLANATION', queue: 'credit_specialist', sensitivity: 'SENSITIVE', audience: 'CONSUMER', urgency: 'NORMAL', order: 40 },
  { code: 'KYC_VERIFICATION', parent: null, domain: 'KYC', label: 'Verificación de identidad', type: 'IDENTITY_KYC', queue: 'consumer_l1', sensitivity: 'SENSITIVE', audience: 'CONSUMER', urgency: 'NORMAL', order: 50 },
  { code: 'PRIVACY_REQUEST', parent: null, domain: 'PRIVACY', label: 'Mis datos personales', type: 'PRIVACY_REQUEST', queue: 'privacy', sensitivity: 'RESTRICTED', audience: 'CONSUMER', urgency: 'NORMAL', order: 60 },
  { code: 'FRAUD_REPORT', parent: null, domain: 'SECURITY', label: 'Reportar un fraude', type: 'FRAUD_REPORT', queue: 'security_fraud', sensitivity: 'RESTRICTED', audience: 'ANY', urgency: 'CRITICAL', order: 70 },
  { code: 'COMPLAINT', parent: null, domain: 'OTHER', label: 'Presentar un reclamo formal', type: 'COMPLAINT', queue: 'complaints', sensitivity: 'SENSITIVE', audience: 'ANY', urgency: 'HIGH', order: 80 },
  { code: 'APP_PROBLEM', parent: null, domain: 'PLATFORM', label: 'La app no funciona bien', type: 'BUG_REPORT', queue: 'consumer_l1', sensitivity: 'NORMAL', audience: 'CONSUMER', urgency: 'NORMAL', order: 90 },
  { code: 'PARTNER_QR', parent: null, domain: 'QR', label: 'Mi QR de cobro', type: 'QR_SUPPORT', queue: 'partner_l1', sensitivity: 'NORMAL', audience: 'PARTNER_USER', urgency: 'HIGH', order: 100 },
  { code: 'PARTNER_ONBOARDING', parent: null, domain: 'PARTNER', label: 'Alta de mi comercio', type: 'PARTNER_ONBOARDING', queue: 'partner_l1', sensitivity: 'SENSITIVE', audience: 'PARTNER_USER', urgency: 'NORMAL', order: 110 },
  { code: 'PARTNER_RECONCILIATION', parent: null, domain: 'REPORTING', label: 'Conciliación y liquidaciones', type: 'RECONCILIATION_SUPPORT', queue: 'partner_operations', sensitivity: 'SENSITIVE', audience: 'PARTNER_USER', urgency: 'HIGH', order: 120 },
  { code: 'PARTNER_BILLING', parent: null, domain: 'REPORTING', label: 'Facturación de comisiones', type: 'BILLING_MDR_SUPPORT', queue: 'partner_operations', sensitivity: 'SENSITIVE', audience: 'PARTNER_USER', urgency: 'NORMAL', order: 130 },
  { code: 'OTHER', parent: null, domain: 'OTHER', label: 'Otra consulta', type: 'QUESTION', queue: 'consumer_l1', sensitivity: 'NORMAL', audience: 'ANY', urgency: 'LOW', order: 900 },
];

const CANNED_ROWS = [
  {
    code: 'security_never_asks',
    audience: 'CONSUMER',
    title: 'Atlas nunca te pide tus claves',
    body:
      'Por tu seguridad: Atlas nunca te pedirá tu contraseña, tu PIN, tu código de verificación ni tu código de ' +
      'recuperación. Si alguien te los pide —aunque diga ser de Atlas— no los compartas y avísanos por aquí.',
    variables: [] as string[],
  },
  {
    code: 'evidence_request',
    audience: 'CONSUMER',
    title: 'Solicitud segura de documento',
    body:
      'Para avanzar necesitamos {{documento}}. Súbelo desde la sección segura de la app: no lo envíes por foto en ' +
      'este chat ni por otro canal. Cuando lo recibamos seguimos con tu caso {{caseNumber}}.',
    variables: ['documento', 'caseNumber'],
  },
  {
    code: 'investigation_in_progress',
    audience: 'CONSUMER',
    title: 'Estamos investigando',
    body:
      'Ya estamos revisando lo que nos contaste en el caso {{caseNumber}}. Te escribimos aquí en cuanto tengamos ' +
      'una respuesta; no hace falta que vuelvas a escribirnos para saber cómo va.',
    variables: ['caseNumber'],
  },
  {
    code: 'credit_decision_explanation',
    audience: 'CONSUMER',
    title: 'Explicación de una decisión de crédito',
    body:
      'Tu solicitud se evaluó con la política vigente y el resultado fue {{resultado}}. Los motivos principales ' +
      'fueron: {{motivos}}. Podemos revisarla si aportas información adicional; desde soporte no modificamos la ' +
      'evaluación, la explicamos y la derivamos al equipo que corresponde.',
    variables: ['resultado', 'motivos'],
  },
  {
    code: 'partner_reconciliation_pending',
    audience: 'PARTNER',
    title: 'Conciliación en revisión',
    body:
      'Recibimos tu reporte de conciliación del período {{periodo}}. Estamos cruzando los movimientos con tu ' +
      'liquidación y te confirmamos por aquí. Tu caso es el {{caseNumber}}.',
    variables: ['periodo', 'caseNumber'],
  },
];

/**
 * Clases de retención del soporte.
 *
 * Se siembran INACTIVAS y declaradas en `RETENTION_POLICIES_PENDING_DECISION`: un expediente de
 * soporte no se purga por antigüedad —hay reclamos, incidentes y bloqueos legales de por medio—, y
 * los plazos concretos son una decisión de Legal y Cumplimiento, no del backend. Dejarlas escritas
 * y visiblemente pendientes es lo contrario de tener una política activa que ningún proceso aplica.
 */
const RETENTION_ROWS = [
  { policy_code: 'support_general', days: 1095, action: 'archive', basis: 'Gestión de servicio ISO/IEC 20000-1', description: 'Casos de soporte ordinarios: consultas, guía de uso e incidencias técnicas resueltas.' },
  { policy_code: 'support_complaint', days: 2555, action: 'archive', basis: 'ISO 10002 y normativa de defensa del consumidor', description: 'Reclamos formales, incluida su investigación y la respuesta emitida.' },
  { policy_code: 'support_security_incident', days: 2555, action: 'archive', basis: 'ISO/IEC 27035 y política de incidentes', description: 'Incidentes de seguridad y reportes de fraude, con su evidencia asociada.' },
  { policy_code: 'support_privacy_request', days: 1825, action: 'archive', basis: 'Prueba de atención de derechos del titular', description: 'Solicitudes sobre datos personales y la respuesta dada a cada una.' },
  { policy_code: 'support_financial_evidence', days: 3650, action: 'archive', basis: 'Conservación de documentación financiera', description: 'Casos con comprobantes de pago y conciliación como evidencia.' },
];

async function tenantIds(queryInterface: QueryInterface): Promise<string[]> {
  const rows = await queryInterface.sequelize.query<{ id: string }>(
    `SELECT _id AS id FROM ${atlasSchemaFor('tenants')}.tenants WHERE _deleted = FALSE ORDER BY _id;`,
    { type: QueryTypes.SELECT },
  );
  return rows.map((row) => String(row.id));
}

export async function up({ context: queryInterface }: SeedContext): Promise<void> {
  for (const tenantId of await tenantIds(queryInterface)) {
    for (const policy of SLA_POLICIES) {
      await queryInterface.sequelize.query(
        `INSERT INTO ${SLA}
           (_tenant_id, policy_code, version_number, priority, status, calendar_kind, timezone,
            acknowledge_target_minutes, first_response_target_minutes, update_interval_minutes,
            resolution_target_minutes, pause_on_waiting_customer, pause_on_waiting_partner,
            pause_on_waiting_internal, warning_percents_json, business_hours_json, change_reason)
         VALUES (:tenantId, :policyCode, 1, :priority, 'active', :calendarKind, 'America/La_Paz',
                 :acknowledge, :firstResponse, :updateInterval, :resolution, :pauseCustomer, :pausePartner,
                 FALSE, '[50, 80]'::jsonb, CAST(:businessHours AS JSONB), 'Política inicial sembrada con el motor de soporte.')
         ON CONFLICT (_tenant_id, policy_code, priority, version_number) DO UPDATE SET
           calendar_kind = EXCLUDED.calendar_kind,
           acknowledge_target_minutes = EXCLUDED.acknowledge_target_minutes,
           first_response_target_minutes = EXCLUDED.first_response_target_minutes,
           update_interval_minutes = EXCLUDED.update_interval_minutes,
           resolution_target_minutes = EXCLUDED.resolution_target_minutes,
           business_hours_json = EXCLUDED.business_hours_json,
           _updated_at = NOW();`,
        {
          replacements: {
            tenantId,
            policyCode: POLICY_CODE,
            priority: policy.priority,
            calendarKind: policy.calendar_kind,
            acknowledge: policy.acknowledge,
            firstResponse: policy.first_response,
            updateInterval: policy.update_interval,
            resolution: policy.resolution,
            pauseCustomer: policy.pause_customer,
            pausePartner: policy.pause_partner,
            businessHours: JSON.stringify(BUSINESS_HOURS),
          },
        },
      );
    }

    for (const queue of QUEUE_ROWS) {
      await queryInterface.sequelize.query(
        `INSERT INTO ${QUEUES}
           (_tenant_id, queue_code, name, description, context_type, skills_required_json,
            business_hours_json, default_priority, sla_policy_code, display_order, is_active)
         VALUES (:tenantId, :code, :name, :description, :context, CAST(:skills AS JSONB),
                 CAST(:businessHours AS JSONB), :priority, :policyCode, :order, TRUE)
         ON CONFLICT (_tenant_id, queue_code) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           skills_required_json = EXCLUDED.skills_required_json,
           default_priority = EXCLUDED.default_priority,
           sla_policy_code = EXCLUDED.sla_policy_code,
           display_order = EXCLUDED.display_order,
           _updated_at = NOW();`,
        {
          replacements: {
            tenantId,
            code: queue.code,
            name: queue.name,
            description: queue.description,
            context: queue.context,
            skills: JSON.stringify(queue.skills),
            businessHours: JSON.stringify(BUSINESS_HOURS),
            priority: queue.priority,
            policyCode: POLICY_CODE,
            order: queue.order,
          },
        },
      );
    }

    // Dos pasadas: primero las raíces, después los hijos, para poder resolver `parent_category_id`.
    for (const pass of [null, 'child'] as const) {
      for (const category of CATEGORY_ROWS) {
        if (pass === null && category.parent !== null) continue;
        if (pass === 'child' && category.parent === null) continue;
        await queryInterface.sequelize.query(
          `INSERT INTO ${CATEGORIES}
             (_tenant_id, category_code, parent_category_id, domain, default_case_type, label, audience,
              sensitivity, default_queue_id, default_impact, default_urgency, requires_specialist,
              catalog_version, display_order, is_active)
           VALUES (:tenantId, :code,
                   (SELECT _id FROM ${CATEGORIES} WHERE _tenant_id = :tenantId AND category_code = :parent LIMIT 1),
                   :domain, :type, :label, :audience, :sensitivity,
                   (SELECT _id FROM ${QUEUES} WHERE _tenant_id = :tenantId AND queue_code = :queue LIMIT 1),
                   'INDIVIDUAL', :urgency, FALSE, 1, :order, TRUE)
           ON CONFLICT (_tenant_id, category_code, catalog_version) DO UPDATE SET
             label = EXCLUDED.label,
             domain = EXCLUDED.domain,
             default_case_type = EXCLUDED.default_case_type,
             audience = EXCLUDED.audience,
             sensitivity = EXCLUDED.sensitivity,
             default_queue_id = EXCLUDED.default_queue_id,
             default_urgency = EXCLUDED.default_urgency,
             display_order = EXCLUDED.display_order,
             _updated_at = NOW();`,
          {
            replacements: {
              tenantId,
              code: category.code,
              parent: category.parent,
              domain: category.domain,
              type: category.type,
              label: category.label,
              audience: category.audience,
              sensitivity: category.sensitivity,
              queue: category.queue,
              urgency: category.urgency,
              order: category.order,
            },
          },
        );
      }
    }

    for (const response of CANNED_ROWS) {
      await queryInterface.sequelize.query(
        `INSERT INTO ${CANNED}
           (_tenant_id, response_code, version_number, locale, title, body_md, allowed_variables_json,
            audience, status, published_at)
         VALUES (:tenantId, :code, 1, 'es-BO', :title, :body, CAST(:variables AS JSONB), :audience, 'published', NOW())
         ON CONFLICT (_tenant_id, response_code, locale, version_number) DO UPDATE SET
           title = EXCLUDED.title,
           body_md = EXCLUDED.body_md,
           allowed_variables_json = EXCLUDED.allowed_variables_json,
           _updated_at = NOW();`,
        {
          replacements: {
            tenantId,
            code: response.code,
            title: response.title,
            body: response.body,
            variables: JSON.stringify(response.variables),
            audience: response.audience,
          },
        },
      );
    }
  }

  for (const retention of RETENTION_ROWS) {
    await queryInterface.sequelize.query(
      /*
       * `_created_at` va explícito: la tabla lo exige NOT NULL y no tiene DEFAULT, así que omitirlo
       * revienta el seed con «null value in column _created_at» — que es como se descubrió.
       */
      `INSERT INTO ${RETENTION}
         (policy_code, applies_to, retention_days, post_retention_action, legal_basis, description, is_active, _created_at)
       SELECT :code, 'support_case', :days, :action, :basis, :description, FALSE, NOW()
        WHERE NOT EXISTS (SELECT 1 FROM ${RETENTION} WHERE policy_code = :code);`,
      {
        replacements: {
          code: retention.policy_code,
          days: retention.days,
          action: retention.action,
          basis: retention.basis,
          description: retention.description,
        },
      },
    );
  }
}

export async function down({ context: queryInterface }: SeedContext): Promise<void> {
  await queryInterface.sequelize.query(`DELETE FROM ${RETENTION} WHERE policy_code IN (:codes);`, {
    replacements: { codes: RETENTION_ROWS.map((row) => row.policy_code) },
  });
  await queryInterface.sequelize.query(`DELETE FROM ${CANNED} WHERE response_code IN (:codes);`, {
    replacements: { codes: CANNED_ROWS.map((row) => row.code) },
  });
  // Primero los hijos: la FK al padre es RESTRICT y se comprueba fila a fila.
  await queryInterface.sequelize.query(`DELETE FROM ${CATEGORIES} WHERE category_code IN (:codes);`, {
    replacements: { codes: CATEGORY_ROWS.filter((row) => row.parent !== null).map((row) => row.code) },
  });
  await queryInterface.sequelize.query(`DELETE FROM ${CATEGORIES} WHERE category_code IN (:codes);`, {
    replacements: { codes: CATEGORY_ROWS.filter((row) => row.parent === null).map((row) => row.code) },
  });
  await queryInterface.sequelize.query(`DELETE FROM ${QUEUES} WHERE queue_code IN (:codes);`, {
    replacements: { codes: QUEUE_ROWS.map((row) => row.code) },
  });
  await queryInterface.sequelize.query(`DELETE FROM ${SLA} WHERE policy_code = :code;`, { replacements: { code: POLICY_CODE } });
}
