/**
 * @file Gobierno del dato: clasificación, campos sensibles, derechos del titular y calidad.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define seeders para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { hashSensitiveText } from '../../../common/utils/crypto/hash.util.js';
import { ID_INTERNOS } from './equipo.seed-data.js';
import { TENANT_DEMO, type DominioSembrado } from './tipos.js';

/** Bloque: 960001–960099 clasificaciones · 960100–960299 reglas de campo · 960300–960399 derechos · 960400–960599 calidad. */
const T = TENANT_DEMO;
const F = '2026-05-01T00:00:00Z';

const CLASIFICACIONES = [
  {
    _id: 960001,
    classification_code: 'PII_DIRECTA',
    classification_name: 'Dato que identifica a una persona por sí solo',
    sensitivity_level: 'RESTRICTED',
    allowed_storage_modes_json: ['encrypted', 'hashed'],
    default_storage_mode: 'encrypted',
    encryption_required: true,
    hashing_required: true,
    raw_storage_allowed: false,
    description:
      'Nombre completo, número de documento, teléfono y correo. Nunca se guarda en claro: se cifra para poder devolverlo y se hashea para poder buscarlo.',
  },
  {
    _id: 960002,
    classification_code: 'PII_INDIRECTA',
    classification_name: 'Dato que identifica combinado con otros',
    sensitivity_level: 'CONFIDENTIAL',
    allowed_storage_modes_json: ['raw', 'encrypted'],
    default_storage_mode: 'raw',
    encryption_required: false,
    hashing_required: false,
    raw_storage_allowed: true,
    description:
      'Fecha de nacimiento, zona, ocupación. Por separado no identifican; tres de ellas juntas, sí. Se guardan en claro pero el acceso queda registrado.',
  },
  {
    _id: 960003,
    classification_code: 'FINANCIERO',
    classification_name: 'Dato financiero de la persona',
    sensitivity_level: 'CONFIDENTIAL',
    allowed_storage_modes_json: ['raw'],
    default_storage_mode: 'raw',
    encryption_required: false,
    hashing_required: false,
    raw_storage_allowed: true,
    description:
      'Ingresos, cuotas, saldos y pagos. Se guarda en claro porque el negocio necesita calcular con él; lo que se controla es quién lo lee.',
  },
  {
    _id: 960004,
    classification_code: 'BIOMETRICO',
    classification_name: 'Dato biométrico',
    sensitivity_level: 'RESTRICTED',
    allowed_storage_modes_json: ['encrypted'],
    default_storage_mode: 'encrypted',
    encryption_required: true,
    hashing_required: false,
    raw_storage_allowed: false,
    description:
      'Selfie y rostro extraído del documento. Sólo cifrado, con acceso nominal y registrado: es la categoría más sensible de todo el sistema.',
  },
  {
    _id: 960005,
    classification_code: 'OPERACIONAL',
    classification_name: 'Dato operativo sin persona detrás',
    sensitivity_level: 'INTERNAL',
    allowed_storage_modes_json: ['raw'],
    default_storage_mode: 'raw',
    encryption_required: false,
    hashing_required: false,
    raw_storage_allowed: true,
    description:
      'Estados, códigos, marcas de tiempo y catálogos. No identifica a nadie y se puede leer sin restricción dentro de la organización.',
  },
  {
    _id: 960006,
    classification_code: 'PUBLICO',
    classification_name: 'Dato público',
    sensitivity_level: 'PUBLIC',
    allowed_storage_modes_json: ['raw'],
    default_storage_mode: 'raw',
    encryption_required: false,
    hashing_required: false,
    raw_storage_allowed: true,
    description: 'Lo que ya es público: razón social, NIT de un comercio, dirección de una sucursal.',
  },
];

interface ReglaCampo {
  readonly tabla: string;
  readonly campo: string;
  readonly clase: string;
  readonly modo: string;
  readonly busqueda: string;
  readonly enmascarado: string;
  readonly acceso: string;
}

const REGLAS: ReglaCampo[] = [
  {
    tabla: 'customer.customers',
    campo: 'primary_phone_encrypted',
    clase: 'PII_DIRECTA',
    modo: 'encrypted',
    busqueda: 'hash_exacto',
    enmascarado: 'ultimos_4',
    acceso: 'soporte_con_caso',
  },
  {
    tabla: 'customer.customers',
    campo: 'primary_email_encrypted',
    clase: 'PII_DIRECTA',
    modo: 'encrypted',
    busqueda: 'hash_exacto',
    enmascarado: 'dominio',
    acceso: 'soporte_con_caso',
  },
  {
    tabla: 'customer.customer_identity_documents',
    campo: 'declared_number_encrypted',
    clase: 'PII_DIRECTA',
    modo: 'encrypted',
    busqueda: 'hash_exacto',
    enmascarado: 'ultimos_4',
    acceso: 'cumplimiento',
  },
  {
    tabla: 'customer.customer_identity_documents',
    campo: 'ocr_full_name',
    clase: 'PII_DIRECTA',
    modo: 'raw',
    busqueda: 'normalizado',
    enmascarado: 'iniciales',
    acceso: 'cumplimiento',
  },
  {
    tabla: 'customer.customer_profile_versions',
    campo: 'birth_date',
    clase: 'PII_INDIRECTA',
    modo: 'raw',
    busqueda: 'rango',
    enmascarado: 'solo_anio',
    acceso: 'riesgo',
  },
  {
    tabla: 'privacy.evidence_documents',
    campo: 'storage_key',
    clase: 'BIOMETRICO',
    modo: 'encrypted',
    busqueda: 'ninguna',
    enmascarado: 'total',
    acceso: 'fraude_con_caso',
  },
  {
    tabla: 'credit.credit_lines',
    campo: 'disposable_income',
    clase: 'FINANCIERO',
    modo: 'raw',
    busqueda: 'rango',
    enmascarado: 'ninguno',
    acceso: 'riesgo',
  },
  {
    tabla: 'credit.loans',
    campo: 'outstanding_principal',
    clase: 'FINANCIERO',
    modo: 'raw',
    busqueda: 'rango',
    enmascarado: 'ninguno',
    acceso: 'operaciones',
  },
  {
    tabla: 'telemetry.customer_location_pings',
    campo: 'latitude',
    clase: 'PII_INDIRECTA',
    modo: 'raw',
    busqueda: 'geo',
    enmascarado: 'redondeo_100m',
    acceso: 'cobranza_con_caso',
  },
  {
    tabla: 'partner.partner_profiles',
    campo: 'tax_id',
    clase: 'PUBLICO',
    modo: 'raw',
    busqueda: 'exacta',
    enmascarado: 'ninguno',
    acceso: 'libre',
  },
];

const reglas = REGLAS.map((r, indice) => ({
  _id: 960100 + indice,
  table_name: r.tabla,
  field_name: r.campo,
  classification_code: r.clase,
  storage_mode: r.modo,
  search_strategy: r.busqueda,
  masking_strategy: r.enmascarado,
  access_policy_code: r.acceso,
  is_active: true,
  _created_at: F,
  _updated_at: F,
}));

const DERECHOS = [
  {
    _id: 960301,
    cliente: 910003,
    tipo: 'access',
    estado: 'in_progress',
    pedido: '2026-09-13T16:20:00Z',
    vence: '2026-10-13T16:20:00Z',
    resuelto: null,
    notas: 'Paquete en preparación. Se entrega por canal autenticado, nunca por correo abierto.',
  },
  {
    _id: 960302,
    cliente: 910005,
    tipo: 'rectification',
    estado: 'completed',
    pedido: '2026-08-02T10:00:00Z',
    vence: '2026-09-01T10:00:00Z',
    resuelto: '2026-08-05T14:30:00Z',
    notas: 'Apellido mal escrito desde el alta. Corregido tras comparar con el documento.',
  },
  {
    _id: 960303,
    cliente: 910010,
    tipo: 'erasure',
    estado: 'rejected',
    pedido: '2026-08-28T09:40:00Z',
    vence: '2026-09-27T09:40:00Z',
    resuelto: '2026-08-30T11:00:00Z',
    notas:
      'No procede la supresión total: la solicitud de crédito rechazada debe conservarse por obligación legal. Se explicó qué sí se borró y qué no, y por qué.',
  },
  {
    _id: 960304,
    cliente: 910002,
    tipo: 'access',
    estado: 'completed',
    pedido: '2026-07-11T12:15:00Z',
    vence: '2026-08-10T12:15:00Z',
    resuelto: '2026-07-19T17:00:00Z',
    notas: 'Entregado dentro de plazo. Incluyó decisiones de crédito y sus motivos comunicables.',
  },
  {
    _id: 960305,
    cliente: 910006,
    tipo: 'objection',
    estado: 'received',
    pedido: '2026-09-16T18:50:00Z',
    vence: '2026-10-16T18:50:00Z',
    resuelto: null,
    notas:
      'Se opone al uso de su ubicación para gestión de cobranza. Pendiente de análisis: hay que separar lo consentido de lo necesario para el contrato.',
  },
];

const derechos = DERECHOS.map((d) => ({
  _id: d._id,
  _tenant_id: T,
  request_code: `DSR-${d._id}`,
  customer_id: d.cliente,
  request_type: d.tipo,
  status: d.estado,
  requested_at: d.pedido,
  due_at: d.vence,
  resolved_at: d.resuelto,
  handled_by: ID_INTERNOS.cumplimiento,
  resolution_notes: d.notas,
  _created_at: d.pedido,
  _updated_at: d.resuelto ?? d.pedido,
  _deleted: false,
}));

interface ReglaCalidad {
  readonly id: number;
  readonly code: string;
  readonly nombre: string;
  readonly tabla: string;
  readonly campo: string;
  readonly severidad: string;
  readonly expresion: Record<string, unknown>;
  readonly accion: string;
  readonly fase: string;
}

const REGLAS_CALIDAD: ReglaCalidad[] = [
  {
    id: 960401,
    code: 'DQ_TELEFONO_LARGO',
    nombre: 'El teléfono tiene el largo del país',
    tabla: 'customer.customer_contact_methods',
    campo: 'value_last_4',
    severidad: 'high',
    expresion: { tipo: 'longitud', pais: 'BO', esperado: 8, incluyePrefijo: '+591' },
    accion: 'bloquear_alta',
    fase: 'ingesta',
  },
  {
    id: 960402,
    code: 'DQ_CARNET_SIN_EXPEDICION',
    nombre: 'El carnet declara dónde fue expedido',
    tabla: 'customer.customer_identity_documents',
    campo: 'declared_issued_in',
    severidad: 'medium',
    expresion: { tipo: 'no_nulo', dominio: ['SC', 'LP', 'CB', 'OR', 'PT', 'TJ', 'CH', 'BE', 'PD'] },
    accion: 'marcar_incidencia',
    fase: 'ingesta',
  },
  {
    id: 960403,
    code: 'DQ_CUOTA_SIN_VENCIMIENTO',
    nombre: 'Toda cuota tiene fecha de vencimiento',
    tabla: 'credit.loan_installments',
    campo: 'due_date',
    severidad: 'critical',
    expresion: { tipo: 'no_nulo' },
    accion: 'bloquear_desembolso',
    fase: 'escritura',
  },
  {
    id: 960404,
    code: 'DQ_SALDO_COHERENTE',
    nombre: 'El saldo es el capital menos lo pagado',
    tabla: 'credit.loans',
    campo: 'outstanding_principal',
    severidad: 'critical',
    expresion: { tipo: 'invariante', formula: 'outstanding_principal = principal_amount - paid_principal' },
    accion: 'alertar_finanzas',
    fase: 'nocturna',
  },
  {
    id: 960405,
    code: 'DQ_COMERCIO_SIN_QR',
    nombre: 'Un comercio aprobado tiene QR activo',
    tabla: 'partner.partner_profiles',
    campo: 'onboarding_status',
    severidad: 'high',
    expresion: { tipo: 'dependencia', si: "onboarding_status='approved'", entonces: 'existe qr activo' },
    accion: 'marcar_incidencia',
    fase: 'nocturna',
  },
  {
    id: 960406,
    code: 'DQ_CORREO_DOMINIO',
    nombre: 'El dominio del correo existe',
    tabla: 'customer.customer_contact_methods',
    campo: 'email_domain',
    severidad: 'low',
    expresion: { tipo: 'formato', patron: '^[a-z0-9.-]+\\.[a-z]{2,}$' },
    accion: 'marcar_incidencia',
    fase: 'ingesta',
  },
  {
    id: 960407,
    code: 'DQ_CASO_SIN_CATEGORIA',
    nombre: 'Todo caso de soporte tiene categoría',
    tabla: 'support.support_cases',
    campo: 'category_id',
    severidad: 'medium',
    expresion: { tipo: 'no_nulo' },
    accion: 'marcar_incidencia',
    fase: 'nocturna',
  },
  {
    id: 960408,
    code: 'DQ_LINEA_SIN_ARTEFACTO',
    nombre: 'Toda línea de crédito dice qué artefacto la decidió',
    tabla: 'credit.credit_lines',
    campo: 'artifact_version_id',
    severidad: 'high',
    expresion: { tipo: 'no_nulo' },
    accion: 'alertar_riesgo',
    fase: 'nocturna',
  },
];

const reglasCalidad = REGLAS_CALIDAD.map((r) => ({
  _id: r.id,
  rule_code: r.code,
  rule_name: r.nombre,
  target_table: r.tabla,
  target_field: r.campo,
  severity: r.severidad,
  expression_json: r.expresion,
  expected_action: r.accion,
  build_phase: r.fase,
  is_active: true,
  _created_at: F,
  _updated_at: F,
}));

const INCIDENCIAS = [
  {
    id: 960501,
    regla: 960402,
    tabla: 'customer.customer_identity_documents',
    registro: '910011',
    estado: 'open',
    detectado: '2026-09-17T02:10:00Z',
    notas: null,
  },
  {
    id: 960502,
    regla: 960406,
    tabla: 'customer.customer_contact_methods',
    registro: '910010',
    estado: 'open',
    detectado: '2026-09-17T02:10:00Z',
    notas: null,
  },
  {
    id: 960503,
    regla: 960405,
    tabla: 'partner.partner_profiles',
    registro: '920005',
    estado: 'acknowledged',
    detectado: '2026-09-16T02:10:00Z',
    notas: 'Conocida: el QR está en revisión porque la imagen llegó cortada. No es un fallo de datos sino del trámite.',
  },
  {
    id: 960504,
    regla: 960401,
    tabla: 'customer.customer_contact_methods',
    registro: '910008',
    estado: 'resolved',
    detectado: '2026-09-06T02:10:00Z',
    resuelto: '2026-09-06T19:00:00Z',
    notas: 'Número con un dígito de más. Corregido tras verificar identidad en el caso CS-2026-0009.',
  },
  {
    id: 960505,
    regla: 960407,
    tabla: 'support.support_cases',
    registro: '940110',
    estado: 'resolved',
    detectado: '2026-09-17T02:10:00Z',
    resuelto: '2026-09-17T08:00:00Z',
    notas: 'Caso interno creado sin categoría desde el portal. Se le asignó «Algo no funciona».',
  },
  {
    id: 960506,
    regla: 960404,
    tabla: 'credit.loans',
    registro: '950308',
    estado: 'open',
    detectado: '2026-09-17T02:10:00Z',
    notas: 'El recargo por mora del mes aún no se imputó a ninguna cuota; la invariante se cumple en capital pero no en cargos.',
  },
];

const incidencias = INCIDENCIAS.map((i) => ({
  _id: i.id,
  _tenant_id: T,
  quality_rule_id: i.regla,
  target_table: i.tabla,
  target_record_id: i.registro,
  issue_status: i.estado,
  detected_at: i.detectado,
  resolved_at: (i as { resuelto?: string }).resuelto ?? null,
  resolution_notes: i.notas,
  _created_at: i.detectado,
}));

const VIGILANCIA = [
  {
    _id: 960601,
    entidad: 'document',
    valor: '6120394',
    razon: 'SUPLANTACION_CONFIRMADA',
    severidad: 'critical',
    nota: 'Carnet usado por dos rostros distintos en quince días.',
  },
  {
    _id: 960602,
    entidad: 'device',
    valor: 'dev-9f41c07ab2',
    razon: 'DISPOSITIVO_COMPARTIDO_SOSPECHOSO',
    severidad: 'high',
    nota: 'Nueve altas distintas desde el mismo dispositivo en 72 horas.',
  },
  {
    _id: 960603,
    entidad: 'phone',
    valor: '+59171234512',
    razon: 'CONTACTO_EN_CASO_DE_FRAUDE',
    severidad: 'medium',
    nota: 'Teléfono asociado al caso de suplantación abierto.',
  },
];

const vigilancia = VIGILANCIA.map((v) => ({
  _id: v._id,
  _tenant_id: T,
  scope: 'tenant',
  entity_type: v.entidad,
  entity_hash: hashSensitiveText(v.valor),
  entity_last_4: v.valor.slice(-4),
  reason_code: v.razon,
  severity: v.severidad,
  status: 'active',
  source_type: 'internal_investigation',
  created_by_type: 'internal_user',
  created_by_internal_user_id: ID_INTERNOS.fraude,
  _created_at: '2026-09-17T01:30:00Z',
  _updated_at: '2026-09-17T01:30:00Z',
  _deleted: false,
}));

export const GOBIERNO: DominioSembrado = {
  nombre: 'gobierno',
  descripcion:
    'Seis clasificaciones de dato, diez reglas de campo sensible, cinco derechos del titular, ocho reglas de calidad con seis incidencias y tres entradas de vigilancia.',
  bloques: [
    { tabla: 'privacy.data_classification_policies', filas: CLASIFICACIONES.map((c) => ({ ...c, _created_at: F, _updated_at: F })) },
    { tabla: 'privacy.sensitive_field_rules', filas: reglas },
    { tabla: 'privacy.data_subject_requests', filas: derechos },
    { tabla: 'audit.data_quality_rules', filas: reglasCalidad },
    { tabla: 'audit.data_quality_issues', filas: incidencias },
    { tabla: 'case_management.watchlist_entries', filas: vigilancia },
  ],
};
