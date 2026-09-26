/**
 * @file Mensajería: qué avisa Atlas, a quién y por qué canal.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define seeders para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { ID_INTERNOS } from './equipo.seed-data.js';
import { TENANT_DEMO, type DominioSembrado } from './tipos.js';

/** Bloque: 970001–970099 políticas · 970100–970199 segmentos · 970200–970299 campañas · 970300–970399 preferencias. */
const T = TENANT_DEMO;
const F = '2026-06-15T00:00:00Z';

interface PoliticaSemilla {
  readonly code: string;
  readonly canal: string;
  readonly etiqueta: string;
  readonly categoria: string;
  readonly obligatoria: boolean;
  readonly razon?: string;
  readonly descripcion: string;
}

const POLITICAS: PoliticaSemilla[] = [
  {
    code: 'cuota_por_vencer',
    canal: 'push',
    etiqueta: 'Tu cuota vence pronto',
    categoria: 'pagos',
    obligatoria: false,
    descripcion: 'Aviso tres días antes del vencimiento. Se puede apagar: recordar no es obligatorio, cobrar sí.',
  },
  {
    code: 'cuota_vencida',
    canal: 'push',
    etiqueta: 'Tu cuota venció',
    categoria: 'pagos',
    obligatoria: true,
    razon: 'Una deuda vencida afecta el historial de la persona; avisarle es parte del contrato, no una preferencia.',
    descripcion: 'Aviso el día siguiente al vencimiento y luego cada tres días mientras siga abierta.',
  },
  {
    code: 'pago_acreditado',
    canal: 'push',
    etiqueta: 'Recibimos tu pago',
    categoria: 'pagos',
    obligatoria: true,
    razon: 'El acuse de un pago es prueba para la persona; no puede depender de que tenga las notificaciones encendidas.',
    descripcion: 'Confirmación en cuanto el pago se imputa a la cuota.',
  },
  {
    code: 'decision_credito',
    canal: 'push',
    etiqueta: 'Respuesta a tu solicitud',
    categoria: 'credito',
    obligatoria: true,
    razon: 'La persona tiene derecho a conocer la decisión y su motivo.',
    descripcion: 'Resultado de la solicitud, con el motivo comunicable cuando es negativo.',
  },
  {
    code: 'limite_actualizado',
    canal: 'push',
    etiqueta: 'Tu límite cambió',
    categoria: 'credito',
    obligatoria: false,
    descripcion: 'Cuando el límite sube o baja tras una revisión.',
  },
  {
    code: 'alerta_seguridad',
    canal: 'push',
    etiqueta: 'Actividad inusual en tu cuenta',
    categoria: 'seguridad',
    obligatoria: true,
    razon: 'Un aviso de seguridad que se puede apagar deja de ser un control.',
    descripcion: 'Acceso desde un dispositivo nuevo, cambio de contraseña o compra fuera de patrón.',
  },
  {
    code: 'codigo_acceso',
    canal: 'sms',
    etiqueta: 'Tu código de acceso',
    categoria: 'seguridad',
    obligatoria: true,
    razon: 'Sin el código no hay forma de entrar.',
    descripcion: 'El código de un solo uso para iniciar sesión.',
  },
  {
    code: 'resumen_mensual',
    canal: 'email',
    etiqueta: 'Tu resumen del mes',
    categoria: 'informativo',
    obligatoria: false,
    descripcion: 'Estado de cuenta del mes con lo pagado y lo pendiente.',
  },
  {
    code: 'novedades',
    canal: 'push',
    etiqueta: 'Novedades y promociones',
    categoria: 'marketing',
    obligatoria: false,
    descripcion: 'Comercios nuevos y campañas. Viene apagado: el consentimiento para publicidad se pide, no se presume.',
  },
  {
    code: 'caso_soporte_respondido',
    canal: 'push',
    etiqueta: 'Respondimos tu caso',
    categoria: 'soporte',
    obligatoria: false,
    descripcion: 'Cuando un agente contesta en un caso abierto.',
  },
];

const politicas = POLITICAS.map((p, indice) => ({
  _tenant_id: T,
  event_code: p.code,
  channel: p.canal,
  label: p.etiqueta,
  description: p.descripcion,
  category: p.categoria,
  is_mandatory: p.obligatoria,
  default_enabled: p.obligatoria ? true : p.code !== 'novedades',
  mandatory_reason: p.razon ?? null,
  display_order: (indice + 1) * 10,
  is_active: true,
  updated_by_internal_user_id: ID_INTERNOS.cumplimiento,
  _created_at: F,
  _updated_at: F,
  _deleted: false,
}));

const SEGMENTOS = [
  {
    _id: 970101,
    name: 'Cuotas por vencer esta semana',
    description: 'Quien tiene una cuota que vence en los próximos siete días y está al día.',
    definition_json: { estadoCliente: ['active'], cuota: { venceEnDias: { min: 0, max: 7 } }, mora: { diasMax: 0 } },
    last_estimate_json: { total: 4, calculadoCon: 'cartera al 2026-09-17' },
  },
  {
    _id: 970102,
    name: 'Mora temprana (1 a 15 días)',
    description: 'Atraso reciente, todavía sin gestión telefónica.',
    definition_json: { mora: { diasMin: 1, diasMax: 15 } },
    last_estimate_json: { total: 1, calculadoCon: 'cartera al 2026-09-17' },
  },
  {
    _id: 970103,
    name: 'Primer crédito pagado y sin nuevo',
    description: 'Cerró su primera operación sin atrasos y no volvió a pedir en 60 días.',
    definition_json: { creditosCerrados: { min: 1 }, creditosVigentes: 0, sinActividadDias: { min: 60 }, peorAtraso: 0 },
    last_estimate_json: { total: 1, calculadoCon: 'cartera al 2026-09-17' },
  },
  {
    _id: 970104,
    name: 'Alta sin terminar',
    description: 'Empezó el registro y no completó la verificación de identidad.',
    definition_json: { estadoCliente: ['onboarding_in_progress'], sinActividadHoras: { min: 12 } },
    last_estimate_json: { total: 1, calculadoCon: 'cartera al 2026-09-17' },
  },
  {
    _id: 970105,
    name: 'Consintieron marketing',
    description: 'Quienes aceptaron recibir promociones. Es el único segmento válido para una campaña de marketing.',
    definition_json: { marketingOptIn: true },
    last_estimate_json: { total: 4, calculadoCon: 'perfiles al 2026-09-17' },
  },
];

const segmentos = SEGMENTOS.map((s) => ({
  ...s,
  _tenant_id: T,
  last_estimated_at: '2026-09-17T03:00:00Z',
  status: 'active',
  created_by: 'internal:930006',
  _created_at: F,
  _updated_at: F,
}));

interface CampanaSemilla {
  readonly id: number;
  readonly uuid: string;
  readonly nombre: string;
  readonly proposito: string;
  readonly estado: string;
  readonly titulo: string;
  readonly cuerpo: string;
  readonly categoria: string;
  readonly segmento: number;
  readonly objetivo: number;
  readonly creados: number;
  readonly inicio: string | null;
  readonly fin: string | null;
  readonly nota: string;
}

const CAMPANAS: CampanaSemilla[] = [
  {
    id: 970201,
    uuid: '00000000-0000-4000-9000-000000970201',
    nombre: 'Recordatorio de cuota · semana 38',
    proposito: 'operational',
    estado: 'completed',
    titulo: 'Tu cuota vence el viernes',
    cuerpo: 'Hola, tu cuota de {{monto}} Bs vence el {{fecha}}. Podés pagarla desde la app en dos toques.',
    categoria: 'pagos',
    segmento: 970101,
    objetivo: 4,
    creados: 4,
    inicio: '2026-09-15T13:00:00Z',
    fin: '2026-09-15T13:02:00Z',
    nota: 'Operativa: no necesita consentimiento de marketing porque es parte del contrato.',
  },
  {
    id: 970202,
    uuid: '00000000-0000-4000-9000-000000970202',
    nombre: 'Mora temprana · septiembre',
    proposito: 'operational',
    estado: 'running',
    titulo: 'Tu cuota quedó pendiente',
    cuerpo: 'Tu cuota venció el {{fecha}}. Regularizala desde la app para mantener tu línea activa; si algo pasó, escribinos y lo vemos.',
    categoria: 'pagos',
    segmento: 970102,
    objetivo: 1,
    creados: 1,
    inicio: '2026-09-17T14:00:00Z',
    fin: null,
    nota: 'En curso. El texto evita el tono intimidatorio que la política de mora prohíbe.',
  },
  {
    id: 970203,
    uuid: '00000000-0000-4000-9000-000000970203',
    nombre: 'Volvé a comprar · octubre',
    proposito: 'marketing',
    estado: 'scheduled',
    titulo: 'Tu línea sigue disponible',
    cuerpo: 'Pagaste tu primer crédito sin un solo atraso. Tu línea de {{limite}} Bs te espera en cualquier comercio de la red.',
    categoria: 'marketing',
    segmento: 970105,
    objetivo: 4,
    creados: 0,
    inicio: '2026-10-01T14:00:00Z',
    fin: null,
    nota: 'Programada. Apunta al segmento de consentimiento, no a toda la base: una campaña de marketing sobre quien no consintió es una infracción, no un error de puntería.',
  },
  {
    id: 970204,
    uuid: '00000000-0000-4000-9000-000000970204',
    nombre: 'Terminá tu registro',
    proposito: 'operational',
    estado: 'draft',
    titulo: 'Te falta poco',
    cuerpo: 'Dejaste tu registro a medias. Te quedan dos minutos: sólo falta la foto del reverso de tu carnet.',
    categoria: 'onboarding',
    segmento: 970104,
    objetivo: 1,
    creados: 0,
    inicio: null,
    fin: null,
    nota: 'Borrador sin programar. Sirve para comprobar que un borrador no envía nada.',
  },
  {
    id: 970205,
    uuid: '00000000-0000-4000-9000-000000970205',
    nombre: 'Aviso de mantenimiento · agosto',
    proposito: 'operational',
    estado: 'cancelled',
    titulo: 'Mantenimiento programado',
    cuerpo: 'El sábado de 02:00 a 04:00 la app no estará disponible.',
    categoria: 'informativo',
    segmento: 970105,
    objetivo: 4,
    creados: 0,
    inicio: '2026-08-20T20:00:00Z',
    fin: null,
    nota: 'Cancelada: el mantenimiento se movió y el aviso habría dado una fecha equivocada.',
  },
];

const campanas = CAMPANAS.map((c) => ({
  _id: c.id,
  _tenant_id: T,
  campaign_uuid: c.uuid,
  name: c.nombre,
  purpose: c.proposito,
  status: c.estado,
  title: c.titulo,
  body: c.cuerpo,
  category: c.categoria,
  channels: ['push', 'in_app'],
  audience_segment_id: c.segmento,
  audience_definition_json: SEGMENTOS.find((s) => s._id === c.segmento)?.definition_json ?? {},
  audience_estimate_json: { total: c.objetivo, nota: c.nota },
  starts_at: c.inicio,
  ends_at: c.fin,
  timezone: 'America/La_Paz',
  rate_per_minute: 600,
  targeted_count: c.objetivo,
  created_count: c.creados,
  created_by: 'internal:930006',
  scheduled_by: c.estado === 'draft' ? null : 'internal:930006',
  scheduled_at: c.estado === 'draft' ? null : c.inicio,
  started_at: ['running', 'completed'].includes(c.estado) ? c.inicio : null,
  finished_at: c.estado === 'completed' ? c.fin : null,
  cancelled_at: c.estado === 'cancelled' ? '2026-08-19T18:00:00Z' : null,
  cancel_reason: c.estado === 'cancelled' ? 'El mantenimiento se reprogramó y el aviso habría dado una fecha equivocada.' : null,
  materialized_at: ['running', 'completed'].includes(c.estado) ? c.inicio : null,
  _created_at: F,
  _updated_at: F,
}));

const PREFERENCIAS = [910001, 910002, 910003, 910005, 910006, 910008].flatMap((cliente, indice) =>
  ['novedades', 'resumen_mensual', 'cuota_por_vencer', 'cuota_vencida'].map((evento, posicion) => ({
    _id: 970300 + indice * 4 + posicion,
    _tenant_id: T,
    customer_id: cliente,
    event_code: evento,
    channel: evento === 'resumen_mensual' ? 'email' : 'push',
    // `cuota_vencida` es obligatoria: aparece para que la persona la vea, no para que la apague.
    is_enabled: evento === 'novedades' ? indice % 2 === 0 : true,
    is_required: evento === 'cuota_vencida',
    _created_at: F,
    _updated_at: F,
  })),
);

export const MENSAJERIA: DominioSembrado = {
  nombre: 'mensajeria',
  descripcion: 'Diez políticas de aviso, cinco segmentos, cinco campañas en estados distintos y las preferencias de seis personas.',
  bloques: [
    {
      tabla: 'messaging.notification_policies',
      filas: politicas,
      conflicto: ['_tenant_id', 'event_code', 'channel'],
      predicado: '_deleted = false',
    },
    { tabla: 'messaging.notification_audience_segments', filas: segmentos },
    { tabla: 'messaging.notification_campaigns', filas: campanas },
    { tabla: 'messaging.user_notification_preferences', filas: PREFERENCIAS },
  ],
};
