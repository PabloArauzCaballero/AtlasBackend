/**
 * @file Seeder idempotente: instala datos de referencia o fixtures del perfil.
 * @business Esta pieza deja escrito qué avisos existen y qué lee el cliente en la app.
 * @system siembra el catálogo de políticas de notificación y el contenido de la app por tenant.
 */
import { QueryInterface, QueryTypes } from 'sequelize';
import { atlasSchemaFor } from '../../domain-schemas.js';

type SeedContext = { context: QueryInterface };

const POLICIES_TABLE = `${atlasSchemaFor('notification_policies')}.notification_policies`;
const CONTENT_TABLE = `${atlasSchemaFor('app_content_entries')}.app_content_entries`;

/**
 * El catálogo de avisos del producto.
 *
 * ## Por qué esto es un seed de PRODUCCIÓN y no de demo
 *
 * Porque sin él la pantalla de preferencias sale vacía —no hay nada que configurar— y, peor, no hay
 * nadie declarando que el aviso de mora es irrenunciable. La obligatoriedad dejó de venir en la
 * petición del cliente justamente para que la declare el servidor; si el servidor no declara nada,
 * el control vuelve a no controlar.
 *
 * ## Qué es obligatorio y por qué
 *
 * Sólo lo que informa de una consecuencia económica que ya está corriendo sobre la persona: el
 * recordatorio de que vence una cuota y el aviso de que entró en mora. Ninguno de los dos vende
 * nada. Apagarlos no silencia un ruido: silencia una deuda que sigue creciendo, y el perjuicio recae
 * entero sobre quien creyó que apagaba una molestia.
 *
 * Todo lo demás —novedades, promociones, resúmenes— es opcional y arranca encendido (opt-out), que
 * es lo que la ley boliviana permite para comunicaciones de una relación contractual existente.
 */
const POLICIES = [
  {
    event_code: 'payment_reminder',
    channel: 'push',
    label: 'Recordatorio de cuota',
    description: 'Te avisamos unos días antes de que venza cada cuota, para que no se te pase.',
    category: 'pagos',
    icon: 'reloj',
    is_mandatory: true,
    mandatory_reason: 'Es el aviso que existe para evitarte la mora. No se puede apagar porque su ausencia te costaría dinero, no tranquilidad.',
    display_order: 10,
  },
  {
    event_code: 'payment_reminder',
    channel: 'email',
    label: 'Recordatorio de cuota por correo',
    description: 'El mismo recordatorio, en tu correo.',
    category: 'pagos',
    icon: 'sobre',
    is_mandatory: false,
    mandatory_reason: null,
    display_order: 11,
  },
  {
    event_code: 'payment_overdue',
    channel: 'push',
    label: 'Aviso de mora',
    description: 'Si una cuota queda vencida te lo decimos de inmediato, con cuánto debes y desde cuándo.',
    category: 'pagos',
    icon: 'alerta',
    is_mandatory: true,
    mandatory_reason: 'Estar en mora tiene consecuencias sobre tu puntaje y tu línea. Enterarte tarde es lo único que lo empeora.',
    display_order: 20,
  },
  {
    event_code: 'payment_overdue',
    channel: 'email',
    label: 'Aviso de mora por correo',
    description: 'El mismo aviso, en tu correo, con el detalle de lo vencido.',
    category: 'pagos',
    icon: 'sobre',
    is_mandatory: true,
    mandatory_reason: 'Queda constancia escrita de lo que se te informó y cuándo. Es tu respaldo tanto como el nuestro.',
    display_order: 21,
  },
  {
    event_code: 'payment_received',
    channel: 'push',
    label: 'Pago recibido',
    description: 'Confirmación cada vez que registramos un pago tuyo.',
    category: 'pagos',
    icon: 'check',
    is_mandatory: false,
    mandatory_reason: null,
    display_order: 30,
  },
  {
    event_code: 'credit_line_changed',
    channel: 'push',
    label: 'Cambios en tu línea',
    description: 'Cuando tu capacidad de pago o tu límite aprobado cambian, y por qué cambiaron.',
    category: 'credito',
    icon: 'tendencia',
    is_mandatory: false,
    mandatory_reason: null,
    display_order: 40,
  },
  {
    event_code: 'bank_statement_reviewed',
    channel: 'push',
    label: 'Resultado de tu extracto',
    description: 'Cuando terminamos de revisar el extracto que subiste y recalculamos tu crédito.',
    category: 'credito',
    icon: 'documento',
    is_mandatory: false,
    mandatory_reason: null,
    display_order: 41,
  },
  {
    event_code: 'security_alert',
    channel: 'push',
    label: 'Alertas de seguridad',
    description: 'Inicios de sesión desde un dispositivo nuevo y cambios en tu PIN.',
    category: 'seguridad',
    icon: 'escudo',
    is_mandatory: true,
    mandatory_reason: 'Es el aviso que te permite darte cuenta de que alguien más entró a tu cuenta. Apagarlo dejaría un acceso ajeno en silencio.',
    display_order: 50,
  },
  {
    event_code: 'product_news',
    channel: 'push',
    label: 'Novedades de Atlas',
    description: 'Nuevos comercios, mejoras y cosas que puedes hacer con tu cuenta.',
    category: 'novedades',
    icon: 'chispa',
    is_mandatory: false,
    mandatory_reason: null,
    display_order: 90,
  },
];

/**
 * Lo que la app enseña y no es un dato del cliente.
 *
 * Estaba escrito dentro de la app: el eslogan, los pasos de bienvenida, las preguntas frecuentes y
 * el teléfono de soporte. Cambiar una coma exigía compilar, firmar y publicar en dos tiendas, y
 * hasta que cada persona actualizara convivían dos versiones distintas de lo que Atlas dice ser. En
 * un producto de crédito eso alcanza a las condiciones, que es donde deja de ser un detalle.
 */
const CONTENT = [
  // ── Bienvenida ────────────────────────────────────────────────────────────────────────────────
  {
    surface: 'onboarding',
    content_key: 'eslogan',
    title: 'Atlas',
    subtitle: 'Tu primer crédito no debería depender de un banco.',
    body_md: null,
    bullets: null,
    metadata: { logoScale: 1.3 },
    action_kind: null,
    action_label: null,
    action_value: null,
    display_order: 0,
  },
  {
    surface: 'onboarding',
    content_key: 'paso-1',
    title: 'Compra hoy, paga en cuotas',
    subtitle: 'Sin tarjeta, sin trámites y sin ir a ninguna oficina.',
    body_md: null,
    bullets: [
      { text: 'Eliges lo que necesitas en un comercio afiliado.', icon: 'comercio' },
      { text: 'Te decimos en el momento cuánto puedes pagar por mes.', icon: 'reloj' },
      { text: 'Te llevas tu compra el mismo día.', icon: 'check' },
    ],
    metadata: null,
    action_kind: null,
    action_label: null,
    action_value: null,
    display_order: 1,
  },
  {
    surface: 'onboarding',
    content_key: 'paso-2',
    title: 'Tu capacidad de pago, calculada de verdad',
    subtitle: 'No es un número inventado ni el mismo para todos.',
    body_md: null,
    bullets: [
      { text: 'Miramos tus ingresos, tus gastos y cómo pagas.', icon: 'tendencia' },
      { text: 'Puedes subir tu extracto bancario para mejorarla.', icon: 'documento' },
      { text: 'Te enseñamos por qué salió ese número.', icon: 'ojo', emphasis: true },
    ],
    metadata: null,
    action_kind: null,
    action_label: null,
    action_value: null,
    display_order: 2,
  },
  {
    surface: 'onboarding',
    content_key: 'paso-3',
    title: 'Paga a tiempo y sube',
    subtitle: 'Tu puntaje Atlas crece con cada cuota pagada.',
    body_md: null,
    bullets: [
      { text: 'Más puntaje es más límite y mejor tasa.', icon: 'estrella' },
      { text: 'Te avisamos antes de cada vencimiento.', icon: 'reloj' },
      { text: 'Si te atrasas te decimos exactamente cuánto te cuesta.', icon: 'alerta' },
    ],
    metadata: null,
    action_kind: null,
    action_label: null,
    action_value: null,
    display_order: 3,
  },

  // ── Ayuda ─────────────────────────────────────────────────────────────────────────────────────
  {
    surface: 'help',
    content_key: 'whatsapp',
    title: '¿Necesitas ayuda?',
    subtitle: 'Escríbenos por WhatsApp y te contesta una persona.',
    body_md: null,
    bullets: null,
    metadata: { whatsappMessage: 'Hola, necesito ayuda con mi cuenta de Atlas.' },
    action_kind: 'whatsapp',
    action_label: 'Escribir por WhatsApp',
    action_value: '77377232',
    display_order: 0,
  },
  {
    surface: 'help',
    content_key: 'tour',
    title: 'Volver a ver el recorrido',
    subtitle: 'Te enseñamos otra vez cómo funciona cada pantalla.',
    body_md: null,
    bullets: null,
    metadata: null,
    action_kind: 'tour',
    action_label: 'Repetir el recorrido',
    action_value: 'inicio',
    display_order: 1,
  },

  // ── Preguntas frecuentes ──────────────────────────────────────────────────────────────────────
  {
    surface: 'faq',
    content_key: 'que-es-atlas',
    title: '¿Qué es exactamente Atlas?',
    subtitle: null,
    body_md:
      'Atlas te permite comprar en comercios afiliados y pagar en cuotas, sin tarjeta de crédito y sin pasar por un banco. ' +
      'Nosotros le pagamos al comercio el día de la compra, y tú nos pagas a nosotros en las cuotas que elegiste.',
    bullets: [
      { text: 'No necesitas tarjeta de crédito ni cuenta en un banco específico.', icon: 'check' },
      { text: 'No hay papeleo: todo el registro se hace desde el celular.', icon: 'check' },
      { text: 'Sabes el monto de la cuota antes de comprometerte, nunca después.', icon: 'check', emphasis: true },
    ],
    metadata: null,
    action_kind: null,
    action_label: null,
    action_value: null,
    display_order: 10,
  },
  {
    surface: 'faq',
    content_key: 'como-se-calcula-mi-limite',
    title: '¿Cómo deciden cuánto me prestan?',
    subtitle: null,
    body_md:
      'Tu límite lo calcula el motor de decisión de Atlas con una política de crédito publicada y versionada — no lo decide ' +
      'una persona mirando tu caso, ni sale de una tabla fija igual para todos. En tu perfil puedes ver el puntaje que salió, ' +
      'con qué datos se calculó y qué dijo la política.',
    bullets: [
      { text: 'Tu ingreso disponible: lo que te queda después de tus gastos declarados.', icon: 'billetera' },
      { text: 'Cómo pagas en Atlas: cada cuota puntual suma, cada atraso resta.', icon: 'tendencia' },
      { text: 'Tu extracto bancario, si decides subirlo. Es opcional y mejora el cálculo.', icon: 'documento' },
      { text: 'De cada dato te decimos si salió de tu expediente, si lo calculamos o si nos falta.', icon: 'ojo', emphasis: true },
    ],
    metadata: null,
    action_kind: null,
    action_label: null,
    action_value: null,
    display_order: 20,
  },
  {
    surface: 'faq',
    content_key: 'para-que-el-extracto',
    title: '¿Para qué me piden el extracto bancario?',
    subtitle: null,
    body_md:
      'Para calcular mejor tu capacidad de pago. Es lo único que te pedimos además de tus datos, porque es el documento que ' +
      'cualquiera puede descargar de su banca en línea en un minuto — no queremos mandarte a hacer trámites.',
    bullets: [
      { text: 'Es opcional. Sin él también tienes línea, sólo que calculada con menos información.', icon: 'ayuda' },
      { text: 'Sirve únicamente como dato de entrada del cálculo. No se comparte con nadie.', icon: 'candado' },
      { text: 'Viaja y se guarda cifrado, y nunca sale de ahí.', icon: 'escudo', emphasis: true },
      { text: 'Te damos el resultado en un máximo de 24 horas.', icon: 'reloj' },
    ],
    metadata: null,
    action_kind: null,
    action_label: null,
    action_value: null,
    display_order: 30,
  },
  {
    surface: 'faq',
    content_key: 'que-pasa-si-me-atraso',
    title: '¿Qué pasa si me atraso en una cuota?',
    subtitle: null,
    body_md:
      'Te lo decimos de inmediato y te decimos cuánto te está costando. Atrasarte baja tu puntaje Atlas y reduce el límite que ' +
      'la política te aprueba, y esos dos efectos los ves en tu perfil el mismo día.',
    bullets: [
      { text: 'Pierdes puntos de puntaje mientras la cuota siga vencida.', icon: 'alerta' },
      { text: 'Tu línea de crédito baja, y te explicamos exactamente por qué bajó.', icon: 'tendencia' },
      { text: 'Ponerte al día lo revierte: el puntaje se recalcula con cada pago.', icon: 'check', emphasis: true },
      { text: 'No es un castigo permanente ni una lista negra.', icon: 'estrella' },
    ],
    metadata: null,
    action_kind: null,
    action_label: null,
    action_value: null,
    display_order: 40,
  },
  {
    surface: 'faq',
    content_key: 'que-hacen-con-mis-datos',
    title: '¿Qué hacen con mis datos?',
    subtitle: null,
    body_md:
      'Los usamos para decidir tu crédito y para cumplir lo que la normativa nos exige guardar. Nada más. Puedes pedirnos ver ' +
      'qué tenemos de ti, corregirlo o retirar tu consentimiento cuando quieras.',
    bullets: [
      { text: 'Nunca vendemos tus datos ni los cedemos con fines comerciales.', icon: 'candado', emphasis: true },
      { text: 'El motor que decide tu crédito no sabe quién eres: te identifica por una referencia sin nombre.', icon: 'escudo' },
      { text: 'Puedes pedir una copia de tu expediente desde tu perfil.', icon: 'documento' },
    ],
    metadata: null,
    action_kind: null,
    action_label: null,
    action_value: null,
    display_order: 50,
  },
  {
    surface: 'faq',
    content_key: 'puedo-apagar-avisos',
    title: '¿Puedo apagar las notificaciones?',
    subtitle: null,
    body_md:
      'Casi todas, sí, desde Preferencias de avisos. Hay tres que no se pueden apagar, y preferimos decirte por qué en lugar de ' +
      'esconder el interruptor.',
    bullets: [
      { text: 'El recordatorio de cuota: existe para evitarte la mora.', icon: 'reloj' },
      { text: 'El aviso de mora: enterarte tarde de una deuda tuya sólo la empeora.', icon: 'alerta' },
      { text: 'Las alertas de seguridad: son las que te avisan si alguien más entra a tu cuenta.', icon: 'escudo', emphasis: true },
    ],
    metadata: null,
    action_kind: 'screen',
    action_label: 'Ir a preferencias de avisos',
    action_value: '/preferencias-avisos',
    display_order: 60,
  },
];

async function tenantIds(queryInterface: QueryInterface): Promise<string[]> {
  const rows = await queryInterface.sequelize.query<{ id: string }>(
    `SELECT _id AS id FROM ${atlasSchemaFor('tenants')}.tenants WHERE _deleted = FALSE ORDER BY _id;`,
    { type: QueryTypes.SELECT },
  );
  return rows.map((row) => String(row.id));
}

export async function up({ context: queryInterface }: SeedContext): Promise<void> {
  const tenants = await tenantIds(queryInterface);

  for (const tenantId of tenants) {
    for (const policy of POLICIES) {
      /*
       * `DO UPDATE` y no `DO NOTHING`: reejecutar el seed tiene que empujar las correcciones de
       * texto a instalaciones que ya lo corrieron. Lo que NO se toca es `is_active` — si operaciones
       * desactivó un aviso, el seed no puede resucitarlo a sus espaldas.
       */
      await queryInterface.sequelize.query(
        `
        INSERT INTO ${POLICIES_TABLE}
          (_tenant_id, event_code, channel, label, description, category, icon,
           is_mandatory, default_enabled, mandatory_reason, display_order, is_active)
        VALUES
          (:tenantId, :eventCode, :channel, :label, :description, :category, :icon,
           :isMandatory, TRUE, :mandatoryReason, :displayOrder, TRUE)
        ON CONFLICT (_tenant_id, event_code, channel) WHERE _deleted = FALSE
        DO UPDATE SET
          label            = EXCLUDED.label,
          description      = EXCLUDED.description,
          category         = EXCLUDED.category,
          icon             = EXCLUDED.icon,
          is_mandatory     = EXCLUDED.is_mandatory,
          mandatory_reason = EXCLUDED.mandatory_reason,
          display_order    = EXCLUDED.display_order,
          _updated_at      = NOW();
        `,
        {
          replacements: {
            tenantId,
            eventCode: policy.event_code,
            channel: policy.channel,
            label: policy.label,
            description: policy.description,
            category: policy.category,
            icon: policy.icon,
            isMandatory: policy.is_mandatory,
            mandatoryReason: policy.mandatory_reason,
            displayOrder: policy.display_order,
          },
        },
      );
    }

    for (const entry of CONTENT) {
      await queryInterface.sequelize.query(
        `
        INSERT INTO ${CONTENT_TABLE}
          (_tenant_id, surface, content_key, locale, title, subtitle, body_md, bullets_json,
           metadata_json, action_kind, action_label, action_value, display_order, is_active, published_at)
        VALUES
          (:tenantId, :surface, :contentKey, 'es-BO', :title, :subtitle, :bodyMd, CAST(:bullets AS JSONB),
           CAST(:metadata AS JSONB), :actionKind, :actionLabel, :actionValue, :displayOrder, TRUE, NOW())
        ON CONFLICT (_tenant_id, surface, content_key, locale) WHERE _deleted = FALSE
        DO UPDATE SET
          title         = EXCLUDED.title,
          subtitle      = EXCLUDED.subtitle,
          body_md       = EXCLUDED.body_md,
          bullets_json  = EXCLUDED.bullets_json,
          metadata_json = EXCLUDED.metadata_json,
          action_kind   = EXCLUDED.action_kind,
          action_label  = EXCLUDED.action_label,
          action_value  = EXCLUDED.action_value,
          display_order = EXCLUDED.display_order,
          _updated_at   = NOW();
        `,
        {
          replacements: {
            tenantId,
            surface: entry.surface,
            contentKey: entry.content_key,
            title: entry.title,
            subtitle: entry.subtitle,
            bodyMd: entry.body_md,
            bullets: entry.bullets ? JSON.stringify(entry.bullets) : null,
            metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
            actionKind: entry.action_kind,
            actionLabel: entry.action_label,
            actionValue: entry.action_value,
            displayOrder: entry.display_order,
          },
        },
      );
    }
  }
}

export async function down({ context: queryInterface }: SeedContext): Promise<void> {
  await queryInterface.sequelize.query(
    `DELETE FROM ${POLICIES_TABLE} WHERE event_code IN (:codes);`,
    { replacements: { codes: [...new Set(POLICIES.map((policy) => policy.event_code))] } },
  );
  await queryInterface.sequelize.query(
    `DELETE FROM ${CONTENT_TABLE} WHERE content_key IN (:keys);`,
    { replacements: { keys: CONTENT.map((entry) => entry.content_key) } },
  );
}
