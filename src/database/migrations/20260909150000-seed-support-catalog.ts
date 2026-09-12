/**
 * @file Migración reversible: siembra el catálogo mínimo con el que el soporte puede operar.
 * @business Sin colas, motivos y política de plazos, abrir un caso falla y nadie puede pedir ayuda.
 * @system inserta por tenant y sólo lo que falta; no toca ninguna fila ya sembrada.
 */
import { QueryInterface, QueryTypes } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const SCHEMA = atlasSchemaFor('support_queues');
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;
const QUEUES = `${SCHEMA}.support_queues`;
const SLA_POLICIES = `${SCHEMA}.support_sla_policies`;
const CATEGORIES = `${SCHEMA}.support_case_categories`;

const SLA_POLICY_CODE = 'atlas_support_default';

/**
 * El catálogo de soporte es DATO MAESTRO, no dato de prueba.
 *
 * Las semillas de Atlas viven fuera del repositorio, en una base aparte (`seed-source.ts`), y eso
 * está bien para clientes de prueba, comercios de ejemplo o carteras de demostración: dato que un
 * despliegue elige tener o no tener. Este catálogo no es de esa clase. El módulo de soporte no
 * FUNCIONA sin él:
 *
 * - `support-case.service.ts` busca la política `atlas_support_default` para poner el reloj de SLA.
 * - `support-channel.service.ts` enruta a `consumer_l1` o `partner_l1` por su código.
 * - `support-case-escalation.service.ts` escala a `consumer_l2`, `security_fraud` y `privacy`.
 * - Abrir un caso exige una categoría del catálogo, y la red de seguridad que evita conversaciones
 *   sin expediente busca la categoría `OTHER`.
 *
 * Los ocho códigos de cola están escritos en `SUPPORT_QUEUE_CODES` y el de la política en el propio
 * servicio: el código ya depende de estos nombres. Que las filas vivieran sólo en una base de
 * semillas significaba que una base recién migrada tenía las tablas creadas y VACÍAS, y entonces
 * cada intento de abrir un caso —desde la app, desde el portal de comercio o desde la consola del
 * agente— moría con `SUPPORT_CATEGORY_NOT_FOUND`. Un módulo entero desplegado y sin forma de
 * usarse, con el fallo apareciendo en el sitio más lejano a su causa.
 *
 * Hay precedente en este mismo repositorio para dato maestro en migración: las políticas de mora,
 * los documentos de consentimiento, el catálogo RBAC interno y las plantillas de notificación.
 *
 * ## Por qué inserta y nunca actualiza
 *
 * Cada `INSERT` lleva su `WHERE NOT EXISTS` por código. En una base que ya tiene el catálogo
 * sembrado —el VPS lo tiene— esta migración no cambia una sola fila: si soporte reorganizó la
 * taxonomía o ajustó un plazo, esa decisión gana. Sembrar con `ON CONFLICT DO UPDATE` habría
 * revertido en un despliegue el trabajo de quien administra el catálogo, que es justo lo contrario
 * de lo que hace falta.
 *
 * ## Lo que este catálogo NO decide
 *
 * Los plazos son un punto de partida operable, no la promesa definitiva: los horarios oficiales por
 * tipo de cliente y los compromisos finales siguen siendo una decisión de negocio pendiente. Se
 * siembran como `business_hours` en `America/La_Paz` y se cambian publicando una versión nueva, que
 * es como esta tabla está diseñada para cambiar (los casos ya abiertos conservan la versión con la
 * que se les prometió).
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await seedSlaPolicies(queryInterface);
  await seedQueues(queryInterface);
  await seedRootCategories(queryInterface);
  await seedChildCategories(queryInterface);
}

/**
 * Una fila por prioridad, todas de la versión 1.
 *
 * P1 se mide en minutos porque es el único compromiso que redondear a horas haría inexpresable: una
 * cuenta bloqueada o un fraude en curso no admiten «cuatro horas para el primer acuse».
 */
async function seedSlaPolicies(queryInterface: QueryInterface): Promise<void> {
  const objetivos = [
    { priority: 'P1', acknowledge: 5, firstResponse: 15, update: 30, resolution: 240 },
    { priority: 'P2', acknowledge: 15, firstResponse: 60, update: 120, resolution: 480 },
    { priority: 'P3', acknowledge: 60, firstResponse: 240, update: 480, resolution: 1440 },
    { priority: 'P4', acknowledge: 240, firstResponse: 480, update: 1440, resolution: 4320 },
  ];

  for (const objetivo of objetivos) {
    await queryInterface.sequelize.query(
      `INSERT INTO ${SLA_POLICIES} (
         _tenant_id, policy_code, version_number, priority, status, calendar_kind, timezone,
         acknowledge_target_minutes, first_response_target_minutes, update_interval_minutes,
         resolution_target_minutes, pause_on_waiting_customer, pause_on_waiting_partner,
         pause_on_waiting_internal, warning_percents_json, change_reason, _created_at
       )
       SELECT t._id, :policyCode, 1, :priority, 'active', 'business_hours', 'America/La_Paz',
              :acknowledge, :firstResponse, :updateInterval, :resolution, TRUE, TRUE, FALSE,
              '[50, 80]'::jsonb, 'Catálogo base sembrado con el módulo. Sustituir publicando una versión nueva.', NOW()
         FROM ${TENANTS} t
        WHERE NOT EXISTS (
          SELECT 1 FROM ${SLA_POLICIES} p
           WHERE p._tenant_id = t._id AND p.policy_code = :policyCode AND p.priority = :priority AND p._deleted = FALSE
        );`,
      {
        replacements: {
          policyCode: SLA_POLICY_CODE,
          priority: objetivo.priority,
          acknowledge: objetivo.acknowledge,
          firstResponse: objetivo.firstResponse,
          updateInterval: objetivo.update,
          resolution: objetivo.resolution,
        },
      },
    );
  }
}

/**
 * Las ocho colas cuyos códigos ya están escritos en `SUPPORT_QUEUE_CODES`.
 *
 * `context_type` no es una etiqueta: impide que un caso de comercio caiga en la cola de
 * consumidores y que un agente de consumidores acabe leyendo el expediente de un comercio.
 */
async function seedQueues(queryInterface: QueryInterface): Promise<void> {
  const colas = [
    {
      code: 'consumer_l1',
      name: 'Consumidores · nivel 1',
      description: 'Primera línea para quien usa la app: acceso, compras, cuotas y pagos.',
      context: 'CONSUMER',
      priority: 'P3',
      skills: ['CONSUMER_SUPPORT'],
      order: 10,
    },
    {
      code: 'consumer_l2',
      name: 'Consumidores · nivel 2',
      description: 'Escalado funcional y jerárquico de la primera línea de consumidores.',
      context: 'CONSUMER',
      priority: 'P2',
      skills: ['CONSUMER_SUPPORT'],
      order: 20,
    },
    {
      code: 'credit_specialist',
      name: 'Especialistas de crédito',
      description: 'Explicación de decisiones de crédito, límites y capacidad de pago.',
      context: 'CONSUMER',
      priority: 'P3',
      skills: ['CREDIT'],
      order: 30,
    },
    {
      code: 'security_fraud',
      name: 'Seguridad y fraude',
      description: 'Incidentes de seguridad y reportes de fraude. Expedientes restringidos.',
      context: 'CONSUMER',
      priority: 'P1',
      skills: ['SECURITY', 'FRAUD'],
      order: 40,
    },
    {
      code: 'privacy',
      name: 'Privacidad',
      description: 'Solicitudes sobre datos personales: acceso, corrección y eliminación.',
      context: 'CONSUMER',
      priority: 'P2',
      skills: ['PRIVACY'],
      order: 50,
    },
    {
      code: 'complaints',
      name: 'Reclamos',
      description: 'Reclamos formales, con su propia clase de retención y su seguimiento.',
      context: 'CONSUMER',
      priority: 'P2',
      skills: ['CONSUMER_SUPPORT'],
      order: 60,
    },
    {
      code: 'partner_l1',
      name: 'Comercios · nivel 1',
      description: 'Primera línea del portal de comercio: alta, accesos y uso diario.',
      context: 'PARTNER_USER',
      priority: 'P3',
      skills: ['PARTNER_SUPPORT'],
      order: 70,
    },
    {
      code: 'partner_operations',
      name: 'Comercios · operaciones',
      description: 'Conciliación, facturación, comisiones y terminales de cobro.',
      context: 'PARTNER_USER',
      priority: 'P2',
      skills: ['PARTNER_SUPPORT', 'RECONCILIATION'],
      order: 80,
    },
  ];

  for (const cola of colas) {
    await queryInterface.sequelize.query(
      `INSERT INTO ${QUEUES} (
         _tenant_id, queue_code, name, description, context_type, skills_required_json,
         default_priority, sla_policy_code, display_order, is_active, _created_at
       )
       SELECT t._id, :code, :name, :description, :context, CAST(:skills AS jsonb),
              :priority, :policyCode, :order, TRUE, NOW()
         FROM ${TENANTS} t
        WHERE NOT EXISTS (
          SELECT 1 FROM ${QUEUES} q WHERE q._tenant_id = t._id AND q.queue_code = :code AND q._deleted = FALSE
        );`,
      {
        replacements: {
          code: cola.code,
          name: cola.name,
          description: cola.description,
          context: cola.context,
          skills: JSON.stringify(cola.skills),
          priority: cola.priority,
          policyCode: SLA_POLICY_CODE,
          order: cola.order,
        },
      },
    );
  }
}

/** Un motivo de primer nivel: lo que la persona reconoce como «de qué va mi problema». */
interface CategoriaRaiz {
  code: string;
  label: string;
  description: string;
  domain: string;
  caseType: string;
  audience: string;
  queue: string;
  sensitivity?: string;
  urgency?: string;
  impact?: string;
  specialist?: boolean;
  order: number;
}

/**
 * Los motivos de primer nivel.
 *
 * La sensibilidad declarada aquí NUNCA ablanda al código: `sensitivityFor` toma el máximo entre el
 * catálogo y el piso que impone el tipo de caso (`SECURITY_SENSITIVE_CASE_TYPES` obliga a SENSITIVE
 * en acceso a cuenta, fraude, seguridad y privacidad). Se declara igual, y no se deja en NORMAL
 * confiando en ese piso, para que el catálogo diga la verdad cuando alguien lo lea: una taxonomía
 * que marca «normal» un expediente de fraude enseña lo contrario de lo que el sistema hace.
 */
const CATEGORIAS_RAIZ: readonly CategoriaRaiz[] = [
  {
    code: 'ACCOUNT_ACCESS',
    label: 'No puedo entrar a mi cuenta',
    description: 'Códigos que no llegan, cuenta bloqueada o dispositivo nuevo.',
    domain: 'AUTH',
    caseType: 'ACCOUNT_ACCESS',
    audience: 'CONSUMER',
    queue: 'consumer_l1',
    sensitivity: 'SENSITIVE',
    urgency: 'HIGH',
    order: 10,
  },
  {
    code: 'PAYMENTS',
    label: 'Pagos y cuotas',
    description: 'Un pago que no aparece, una cuota que no cuadra o un comprobante sin aplicar.',
    domain: 'PAYMENT',
    caseType: 'PAYMENT_EVIDENCE',
    audience: 'CONSUMER',
    queue: 'consumer_l1',
    order: 20,
  },
  {
    code: 'CREDIT',
    label: 'Mi crédito',
    description: 'Por qué se decidió así, cuál es mi límite y qué puedo hacer.',
    domain: 'CREDIT',
    caseType: 'CREDIT_DECISION_EXPLANATION',
    audience: 'CONSUMER',
    queue: 'credit_specialist',
    specialist: true,
    order: 30,
  },
  {
    code: 'KYC',
    label: 'Verificación de identidad',
    description: 'Problemas al verificar el carnet o la selfie.',
    domain: 'KYC',
    caseType: 'IDENTITY_KYC',
    audience: 'CONSUMER',
    queue: 'consumer_l1',
    sensitivity: 'SENSITIVE',
    order: 40,
  },
  {
    code: 'PURCHASE_QR',
    label: 'Comprar con QR',
    description: 'El QR no se lee, la compra no se registró o el comercio no la ve.',
    domain: 'QR',
    caseType: 'QR_SUPPORT',
    audience: 'CONSUMER',
    queue: 'consumer_l1',
    order: 50,
  },
  {
    code: 'FRAUD_REPORT',
    label: 'Reportar un fraude',
    description: 'Movimientos que no reconozco o alguien usando mi identidad.',
    domain: 'SECURITY',
    caseType: 'FRAUD_REPORT',
    audience: 'CONSUMER',
    queue: 'security_fraud',
    sensitivity: 'RESTRICTED',
    urgency: 'CRITICAL',
    specialist: true,
    order: 60,
  },
  {
    code: 'PRIVACY_REQUEST',
    label: 'Mis datos personales',
    description: 'Acceder a mis datos, corregirlos o pedir que se eliminen.',
    domain: 'PRIVACY',
    caseType: 'PRIVACY_REQUEST',
    audience: 'CONSUMER',
    queue: 'privacy',
    sensitivity: 'RESTRICTED',
    order: 70,
  },
  {
    code: 'COMPLAINT',
    label: 'Presentar un reclamo',
    description: 'Un reclamo formal sobre el servicio o sobre cómo se me atendió.',
    domain: 'OTHER',
    caseType: 'COMPLAINT',
    audience: 'CONSUMER',
    queue: 'complaints',
    urgency: 'HIGH',
    order: 80,
  },
  {
    code: 'PARTNER_ONBOARDING',
    label: 'Alta y activación del comercio',
    description: 'Documentos, revisión del expediente y activación para cobrar.',
    domain: 'PARTNER',
    caseType: 'PARTNER_ONBOARDING',
    audience: 'PARTNER_USER',
    queue: 'partner_l1',
    order: 110,
  },
  {
    code: 'PARTNER_OPERATION',
    label: 'Operar el comercio',
    description: 'Usuarios, sucursales, terminales y el día a día del portal.',
    domain: 'PARTNER',
    caseType: 'PARTNER_OPERATION',
    audience: 'PARTNER_USER',
    queue: 'partner_l1',
    order: 120,
  },
  {
    code: 'PARTNER_RECONCILIATION',
    label: 'Conciliación de cobros',
    description: 'Una venta que no aparece en la liquidación o un monto que no cuadra.',
    domain: 'REPORTING',
    caseType: 'RECONCILIATION_SUPPORT',
    audience: 'PARTNER_USER',
    queue: 'partner_operations',
    order: 130,
  },
  {
    code: 'PARTNER_BILLING',
    label: 'Facturación y comisiones',
    description: 'La factura del período, la comisión aplicada o el plan contratado.',
    domain: 'REPORTING',
    caseType: 'BILLING_MDR_SUPPORT',
    audience: 'PARTNER_USER',
    queue: 'partner_operations',
    order: 140,
  },
  {
    code: 'BUG_REPORT',
    label: 'Algo no funciona',
    description: 'Un error de la aplicación o del portal que se puede reproducir.',
    domain: 'PLATFORM',
    caseType: 'BUG_REPORT',
    audience: 'ANY',
    queue: 'consumer_l2',
    order: 900,
  },
  /*
   * `OTHER` es la RED DE SEGURIDAD, no un cajón de sastre para quien no quiera elegir.
   *
   * `createUnclassifiedCase` la busca por este código exacto para que ninguna conversación se quede
   * sin expediente cuando alguien abre un chat sin decir de qué va. Va la última en el orden y con
   * audiencia ANY porque tiene que servir a los tres públicos. Si falta esta fila, el arreglo de la
   * fase B2 —ningún chat sin caso— deja de funcionar en silencio.
   */
  {
    code: 'OTHER',
    label: 'Otro motivo',
    description: 'Cuando ninguno de los anteriores describe el problema.',
    domain: 'OTHER',
    caseType: 'OTHER',
    audience: 'ANY',
    queue: 'consumer_l1',
    order: 999,
  },
];

/** Submotivos: cuelgan de su raíz y heredan su audiencia. Es lo que se puede contar y enrutar. */
const CATEGORIAS_HIJAS: readonly (CategoriaRaiz & { parent: string })[] = [
  {
    parent: 'ACCOUNT_ACCESS',
    code: 'AUTH_OTP_NOT_RECEIVED',
    label: 'No me llega el código',
    description: 'El SMS o el correo con el código de acceso no llega.',
    domain: 'AUTH',
    caseType: 'ACCOUNT_ACCESS',
    audience: 'CONSUMER',
    queue: 'consumer_l1',
    sensitivity: 'SENSITIVE',
    urgency: 'HIGH',
    order: 11,
  },
  {
    parent: 'ACCOUNT_ACCESS',
    code: 'AUTH_ACCOUNT_LOCKED',
    label: 'Mi cuenta está bloqueada',
    description: 'La cuenta quedó bloqueada tras varios intentos o por una medida de seguridad.',
    domain: 'AUTH',
    caseType: 'ACCOUNT_ACCESS',
    audience: 'CONSUMER',
    queue: 'consumer_l1',
    sensitivity: 'SENSITIVE',
    urgency: 'HIGH',
    order: 12,
  },
  {
    parent: 'PAYMENTS',
    code: 'PAY_EVIDENCE_NOT_APPLIED',
    label: 'Pagué y no se refleja',
    description: 'El comprobante existe y la cuota sigue figurando como pendiente.',
    domain: 'PAYMENT',
    caseType: 'PAYMENT_EVIDENCE',
    audience: 'CONSUMER',
    queue: 'consumer_l2',
    urgency: 'HIGH',
    order: 21,
  },
  {
    parent: 'PAYMENTS',
    code: 'PAY_INSTALLMENT_MISMATCH',
    label: 'La cuota no cuadra',
    description: 'El monto, la fecha o los intereses de la cuota no coinciden con lo pactado.',
    domain: 'INSTALLMENTS',
    caseType: 'SERVICE_REQUEST',
    audience: 'CONSUMER',
    queue: 'consumer_l1',
    order: 22,
  },
  {
    parent: 'CREDIT',
    code: 'CREDIT_DECISION_EXPLANATION',
    label: 'Por qué me dieron esta respuesta',
    description: 'Explicación de la decisión de crédito y de los motivos que la sostienen.',
    domain: 'CREDIT',
    caseType: 'CREDIT_DECISION_EXPLANATION',
    audience: 'CONSUMER',
    queue: 'credit_specialist',
    specialist: true,
    order: 31,
  },
  {
    parent: 'CREDIT',
    code: 'CREDIT_LIMIT_QUESTION',
    label: 'Mi límite de crédito',
    description: 'Cuánto tengo disponible, por qué es ese monto y cómo puede cambiar.',
    domain: 'CREDIT',
    caseType: 'QUESTION',
    audience: 'CONSUMER',
    queue: 'credit_specialist',
    order: 32,
  },
  {
    parent: 'KYC',
    code: 'KYC_DOCUMENT_REJECTED',
    label: 'Rechazaron mi documento',
    description: 'El carnet o la selfie no pasaron la verificación.',
    domain: 'KYC',
    caseType: 'IDENTITY_KYC',
    audience: 'CONSUMER',
    queue: 'consumer_l1',
    sensitivity: 'SENSITIVE',
    order: 41,
  },
  {
    parent: 'PARTNER_OPERATION',
    code: 'PARTNER_QR_TERMINAL',
    label: 'QR y terminales de cobro',
    description: 'El QR del comercio o la terminal no funcionan como deberían.',
    domain: 'QR',
    caseType: 'QR_SUPPORT',
    audience: 'PARTNER_USER',
    queue: 'partner_operations',
    urgency: 'HIGH',
    order: 121,
  },
];

function insertCategorySql(withParent: boolean): string {
  const parentColumn = withParent
    ? `(SELECT p._id FROM ${CATEGORIES} p WHERE p._tenant_id = t._id AND p.category_code = :parentCode AND p._deleted = FALSE ORDER BY p.catalog_version DESC LIMIT 1)`
    : 'NULL';

  return `INSERT INTO ${CATEGORIES} (
      _tenant_id, category_code, parent_category_id, domain, default_case_type, label, description,
      audience, sensitivity, default_queue_id, default_impact, default_urgency, requires_specialist,
      catalog_version, display_order, is_active, _created_at
    )
    SELECT t._id, :code, ${parentColumn}, :domain, :caseType, :label, :description,
           :audience, :sensitivity,
           (SELECT q._id FROM ${QUEUES} q WHERE q._tenant_id = t._id AND q.queue_code = :queue AND q._deleted = FALSE LIMIT 1),
           :impact, :urgency, :specialist, 1, :order, TRUE, NOW()
      FROM ${TENANTS} t
     WHERE NOT EXISTS (
       SELECT 1 FROM ${CATEGORIES} c WHERE c._tenant_id = t._id AND c.category_code = :code AND c._deleted = FALSE
     );`;
}

function categoryReplacements(categoria: CategoriaRaiz): Record<string, unknown> {
  return {
    code: categoria.code,
    domain: categoria.domain,
    caseType: categoria.caseType,
    label: categoria.label,
    description: categoria.description,
    audience: categoria.audience,
    sensitivity: categoria.sensitivity ?? 'NORMAL',
    queue: categoria.queue,
    impact: categoria.impact ?? 'INDIVIDUAL',
    urgency: categoria.urgency ?? 'NORMAL',
    specialist: categoria.specialist ?? false,
    order: categoria.order,
  };
}

async function seedRootCategories(queryInterface: QueryInterface): Promise<void> {
  for (const categoria of CATEGORIAS_RAIZ) {
    await queryInterface.sequelize.query(insertCategorySql(false), { replacements: categoryReplacements(categoria) });
  }
}

/**
 * Las hijas van en una segunda pasada porque necesitan el `_id` de su raíz, que la primera acaba de
 * crear. Una sola pasada obligaría a ordenar el arreglo por dependencia y a confiar en ese orden.
 */
async function seedChildCategories(queryInterface: QueryInterface): Promise<void> {
  for (const categoria of CATEGORIAS_HIJAS) {
    await queryInterface.sequelize.query(insertCategorySql(true), {
      replacements: { ...categoryReplacements(categoria), parentCode: categoria.parent },
    });
  }
}

/**
 * Revertir borra el catálogo base, y sólo si nadie lo está usando.
 *
 * Un caso guarda su `category_id` y su `sla_policy_version_id`: borrar esas filas con expedientes
 * vivos dejaría un historial que ya no se puede leer —o lo impediría la clave foránea a mitad de la
 * reversión, con el esquema medio revertido—. Por eso se comprueba antes y, si hay casos, se deja
 * el catálogo donde está: en una reversión, perder la trazabilidad es peor que dejar filas de más.
 */
export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  const CASES = `${atlasSchemaFor('support_cases')}.support_cases`;
  const filas = await queryInterface.sequelize.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM ${CASES};`, {
    type: QueryTypes.SELECT,
  });
  if (Number(filas[0]?.total ?? 0) > 0) return;

  const codigosCategoria = [...CATEGORIAS_HIJAS, ...CATEGORIAS_RAIZ].map((categoria) => categoria.code);
  await queryInterface.sequelize.query(`DELETE FROM ${CATEGORIES} WHERE category_code IN (:codes) AND catalog_version = 1;`, {
    replacements: { codes: codigosCategoria },
  });
  await queryInterface.sequelize.query(`DELETE FROM ${QUEUES} WHERE queue_code IN (:codes);`, {
    replacements: {
      codes: [
        'consumer_l1',
        'consumer_l2',
        'credit_specialist',
        'security_fraud',
        'privacy',
        'complaints',
        'partner_l1',
        'partner_operations',
      ],
    },
  });
  await queryInterface.sequelize.query(`DELETE FROM ${SLA_POLICIES} WHERE policy_code = :policyCode AND version_number = 1;`, {
    replacements: { policyCode: SLA_POLICY_CODE },
  });
}
