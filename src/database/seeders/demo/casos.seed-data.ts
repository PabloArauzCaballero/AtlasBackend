/**
 * @file Casos que decide una persona: revisión manual y fraude, con su bitácora.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define seeders para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { hashSensitiveText } from '../../../common/utils/crypto/hash.util.js';
import { ID_INTERNOS } from './equipo.seed-data.js';
import { TENANT_DEMO, type DominioSembrado, type FilaSembrada } from './tipos.js';

/** Bloque: 980001–980099 revisión · 980100–980199 fraude · 980200–980399 eventos · 980400–980499 coincidencias. */
const T = TENANT_DEMO;

interface RevisionSemilla {
  readonly id: number;
  readonly cliente: number;
  readonly tipo: string;
  readonly prioridad: string;
  readonly estado: string;
  readonly asignado: number | null;
  readonly abierto: string;
  readonly cerrado: string | null;
  readonly resolucion: string | null;
  readonly notas: string;
  readonly bitacora: readonly { readonly tipo: string; readonly nota: string }[];
}

const REVISIONES: RevisionSemilla[] = [
  {
    id: 980001,
    cliente: 910007,
    tipo: 'identity_verification',
    prioridad: 'high',
    estado: 'in_progress',
    asignado: ID_INTERNOS.cumplimiento,
    abierto: '2026-09-11T19:10:00Z',
    cerrado: null,
    resolucion: null,
    notas: 'Tres capturas con confianza por debajo del umbral. Nombre y rostro coinciden; el problema es la calidad de la foto.',
    bitacora: [
      { tipo: 'case_opened', nota: 'Abierto automáticamente al tercer intento fallido de verificación.' },
      { tipo: 'assigned', nota: 'Asignado a Cumplimiento por antigüedad en cola.' },
      { tipo: 'note_added', nota: 'Comparadas las tres capturas: reflejo sobre el holograma en las tres. Se pidió repetir por soporte.' },
    ],
  },
  {
    id: 980002,
    cliente: 910010,
    tipo: 'affordability_override',
    prioridad: 'medium',
    estado: 'closed',
    asignado: ID_INTERNOS.riesgo,
    abierto: '2026-08-22T12:30:00Z',
    cerrado: '2026-08-23T10:15:00Z',
    resolucion: 'upheld',
    notas: 'La persona pidió revisión del rechazo. Se revisó con la boleta que aportó y el resultado no cambia.',
    bitacora: [
      { tipo: 'case_opened', nota: 'Solicitud de revisión del propio cliente tras el rechazo.' },
      { tipo: 'evidence_added', nota: 'Aportó una boleta de pago. El ingreso declarado coincide con el usado en la evaluación.' },
      {
        tipo: 'decision_made',
        nota: 'Se mantiene el rechazo: con ese ingreso la cuota sigue por encima del tope. Se le explicó y se le ofreció monto menor.',
      },
    ],
  },
  {
    id: 980003,
    cliente: 910012,
    tipo: 'fraud_suspicion',
    prioridad: 'critical',
    estado: 'escalated',
    asignado: ID_INTERNOS.fraude,
    abierto: '2026-09-16T23:40:00Z',
    cerrado: null,
    resolucion: null,
    notas: 'Rostro distinto al del alta usando el mismo documento. Escalado a caso de fraude.',
    bitacora: [
      { tipo: 'case_opened', nota: 'El comparador de rostro marcó discrepancia con la selfie del alta.' },
      { tipo: 'escalated', nota: 'Escalado a fraude: no es un problema de captura, son dos personas distintas.' },
    ],
  },
  {
    id: 980004,
    cliente: 910011,
    tipo: 'document_quality',
    prioridad: 'low',
    estado: 'open',
    asignado: null,
    abierto: '2026-09-17T02:15:00Z',
    cerrado: null,
    resolucion: null,
    notas: 'El alta quedó a medias con el reverso del carnet sin capturar. Sin asignar: es el caso que la cola debe mostrar libre.',
    bitacora: [{ tipo: 'case_opened', nota: 'Abierto por la regla de calidad DQ_CARNET_SIN_EXPEDICION.' }],
  },
  {
    id: 980005,
    cliente: 910008,
    tipo: 'delinquency_review',
    prioridad: 'medium',
    estado: 'closed',
    asignado: ID_INTERNOS.cobranza,
    abierto: '2026-07-20T14:00:00Z',
    cerrado: '2026-07-22T16:30:00Z',
    resolucion: 'plan_agreed',
    notas: 'Dos atrasos seguidos. Se acordó mover la fecha de cobro al día 5, que es cuando la persona cobra.',
    bitacora: [
      { tipo: 'case_opened', nota: 'Segundo atraso consecutivo de más de siete días.' },
      {
        tipo: 'contact_made',
        nota: 'Contacto telefónico exitoso. El atraso es de calendario, no de capacidad: cobra el 3 y la cuota vencía el 2.',
      },
      { tipo: 'decision_made', nota: 'Fecha de cobro movida al día 5. Cliente pasa a observado, no a suspendido.' },
    ],
  },
];

const FRAUDES = [
  {
    id: 980101,
    cliente: 910012,
    estado: 'investigating',
    severidad: 'critical',
    patron: 'suplantacion_documental',
    abierto: '2026-09-16T23:55:00Z',
    cerrado: null,
    resolucion: null,
    asignado: ID_INTERNOS.fraude,
    notas:
      'Un mismo carnet con dos rostros en quince días, dispositivo nuevo e IP de otra ciudad. La cuenta quedó bloqueada y el crédito anulado sin desembolsar.',
    bitacora: [
      { tipo: 'case_opened', nota: 'Escalado desde la revisión manual 980003.' },
      { tipo: 'account_blocked', nota: 'Cuenta bloqueada de forma preventiva antes de contactar al titular.' },
      { tipo: 'loan_cancelled', nota: 'Crédito PR-950310 anulado sin desembolsar.' },
      { tipo: 'watchlist_added', nota: 'Documento y dispositivo añadidos a vigilancia.' },
    ],
  },
  {
    id: 980102,
    cliente: 910009,
    estado: 'closed',
    severidad: 'low',
    patron: 'reclamo_sin_sustento',
    abierto: '2026-06-11T10:20:00Z',
    cerrado: '2026-06-13T15:00:00Z',
    resolucion: 'no_fraud',
    asignado: ID_INTERNOS.fraude,
    notas:
      'Denunció una compra que sí había hecho ella, desde su propio dispositivo y en un comercio a dos cuadras de su domicilio. Se cerró sin consecuencias para la persona.',
    bitacora: [
      { tipo: 'case_opened', nota: 'Denuncia de compra desconocida.' },
      { tipo: 'evidence_reviewed', nota: 'Mismo dispositivo, misma sesión y comercio habitual. No hay indicio de terceros.' },
      { tipo: 'case_closed', nota: 'Cerrado como sin fraude. Se le explicó con el detalle de la compra; no se aplicó ninguna marca.' },
    ],
  },
];

const eventosRevision: FilaSembrada[] = [];
const eventosFraude: FilaSembrada[] = [];
let idEvento = 980200;

for (const r of REVISIONES) {
  r.bitacora.forEach((paso, posicion) => {
    eventosRevision.push({
      _id: idEvento++,
      _tenant_id: T,
      manual_review_case_id: r.id,
      event_type: paso.tipo,
      actor_type: paso.tipo === 'case_opened' ? 'system' : 'internal_user',
      actor_internal_user_id: paso.tipo === 'case_opened' ? null : r.asignado,
      happened_at: r.abierto,
      payload_json: { paso: posicion + 1 },
      notes: paso.nota,
      _created_at: r.abierto,
    });
  });
}

for (const f of FRAUDES) {
  f.bitacora.forEach((paso, posicion) => {
    eventosFraude.push({
      _id: idEvento++,
      _tenant_id: T,
      fraud_case_id: f.id,
      event_type: paso.tipo,
      actor_type: paso.tipo === 'case_opened' ? 'system' : 'internal_user',
      actor_internal_user_id: paso.tipo === 'case_opened' ? null : f.asignado,
      happened_at: f.abierto,
      payload_json: { paso: posicion + 1 },
      notes: paso.nota,
      _created_at: f.abierto,
    });
  });
}

const revisiones = REVISIONES.map((r) => ({
  _id: r.id,
  _tenant_id: T,
  case_code: `RM-${r.id}`,
  customer_id: r.cliente,
  fraud_case_id: null,
  case_type: r.tipo,
  priority: r.prioridad,
  status: r.estado,
  assigned_to_internal_user_id: r.asignado,
  opened_at: r.abierto,
  closed_at: r.cerrado,
  resolution: r.resolucion,
  notes: r.notas,
  _created_at: r.abierto,
  _updated_at: r.cerrado ?? r.abierto,
  _deleted: false,
}));

const fraudes = FRAUDES.map((f) => ({
  _id: f.id,
  _tenant_id: T,
  case_code: `FR-${f.id}`,
  customer_id: f.cliente,
  escalated_from_review_case_id: f.id === 980101 ? 980003 : null,
  case_status: f.estado,
  severity: f.severidad,
  pattern_detected: f.patron,
  linked_customers_json: f.id === 980101 ? [910012] : [],
  linked_sessions_json: [],
  linked_devices_json: f.id === 980101 ? ['dev-9f41c07ab2'] : [],
  assigned_to_internal_user_id: f.asignado,
  opened_at: f.abierto,
  closed_at: f.cerrado,
  resolution: f.resolucion,
  notes: f.notas,
  _created_at: f.abierto,
  _updated_at: f.cerrado ?? f.abierto,
  _deleted: false,
}));

const coincidencias = [
  {
    _id: 980401,
    _tenant_id: T,
    watchlist_entry_id: 960601,
    customer_id: 910012,
    matched_entity_type: 'document',
    matched_value_hash: hashSensitiveText('6120394'),
    match_method: 'hash_exacto',
    match_confidence: 1.0,
    opened_fraud_case_id: 980101,
    matched_at: '2026-09-17T01:35:00Z',
    _created_at: '2026-09-17T01:35:00Z',
  },
  {
    _id: 980402,
    _tenant_id: T,
    watchlist_entry_id: 960603,
    customer_id: 910012,
    matched_entity_type: 'phone',
    matched_value_hash: hashSensitiveText('+59171234512'),
    match_method: 'hash_exacto',
    match_confidence: 1.0,
    opened_fraud_case_id: 980101,
    matched_at: '2026-09-17T01:36:00Z',
    _created_at: '2026-09-17T01:36:00Z',
  },
];

/**
 * El enlace del caso de revisión con el de fraude va en un tercer paso.
 *
 * Las dos tablas se apuntan mutuamente —una revisión puede escalar a fraude y un fraude recuerda de
 * qué revisión vino—, así que ninguna de las dos puede escribirse completa antes que la otra. Se
 * insertan sin el enlace y se cierra el círculo al final, que es lo mismo que hace el runtime.
 */
const enlaceConFraude = [{ _id: 980003, _tenant_id: T, fraud_case_id: 980101, _created_at: '2026-09-16T23:40:00Z' }];

export const CASOS: DominioSembrado = {
  nombre: 'casos',
  descripcion: 'Cinco casos de revisión manual y dos de fraude, cada uno con la bitácora de lo que hizo cada persona y por qué.',
  bloques: [
    { tabla: 'case_management.manual_review_cases', filas: revisiones },
    { tabla: 'case_management.fraud_cases', filas: fraudes },
    { tabla: 'case_management.manual_review_cases', filas: enlaceConFraude },
    { tabla: 'case_management.manual_review_events', filas: eventosRevision },
    { tabla: 'case_management.fraud_case_events', filas: eventosFraude },
    { tabla: 'case_management.watchlist_matches', filas: coincidencias },
  ],
};
