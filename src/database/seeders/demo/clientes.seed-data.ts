/**
 * @file Personas de demostración: doce clientes con estados de ciclo de vida distintos.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define seeders para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { hashSensitiveText, lastCharacters } from '../../../common/utils/crypto/hash.util.js';
import { TENANT_DEMO, type DominioSembrado } from './tipos.js';

/**
 * Son personas INVENTADAS, y a propósito cubren estados distintos: si todas estuvieran activas, la
 * pantalla de clientes se vería llena y sus filtros seguirían sin poder comprobarse.
 *
 * Los teléfonos y correos se guardan como el runtime los guarda —hash, últimos cuatro dígitos y
 * dominio— y la columna cifrada queda nula: sembrar texto cifrado exigiría la llave del entorno, y
 * una llave de siembra que viaje con el repositorio es justo lo que no debe existir. Lo que el
 * portal enseña de un teléfono son los últimos cuatro dígitos, que sí están.
 *
 * Bloque de identificadores: 910001–910099 clientes · 910100–910299 versiones de perfil ·
 * 910300–910499 contactos · 910500–910599 documentos · 910600–910799 eventos de estado.
 */
interface PersonaSemilla {
  readonly id: number;
  readonly nombre: string;
  readonly apellido: string;
  readonly nacimiento: string;
  readonly genero: string;
  readonly telefono: string;
  readonly correo: string;
  readonly estado: string;
  readonly elegibilidad: string | null;
  readonly alta: string;
  readonly carnet: string;
  readonly expedido: string;
  readonly historia: string;
}

const PERSONAS: PersonaSemilla[] = [
  {
    id: 910001,
    nombre: 'María Elena',
    apellido: 'Quispe Mamani',
    nacimiento: '1989-04-12',
    genero: 'F',
    telefono: '+59171234501',
    correo: 'melena.quispe@example.bo',
    estado: 'active',
    elegibilidad: 'eligible',
    alta: '2026-02-14T10:12:00Z',
    carnet: '4821507',
    expedido: 'SC',
    historia:
      'Comerciante minorista en el mercado Mutualista. Tres créditos pagados sin atraso; es el perfil que el modelo aprueba sin discusión.',
  },
  {
    id: 910002,
    nombre: 'Juan Carlos',
    apellido: 'Rojas Vaca',
    nacimiento: '1994-11-03',
    genero: 'M',
    telefono: '+59171234502',
    correo: 'jc.rojas@example.bo',
    estado: 'active',
    elegibilidad: 'eligible',
    alta: '2026-03-02T16:40:00Z',
    carnet: '7734218',
    expedido: 'SC',
    historia: 'Empleado privado con boleta. Un crédito vigente al día; pide siempre en ferretería.',
  },
  {
    id: 910003,
    nombre: 'Rosa',
    apellido: 'Choque Apaza',
    nacimiento: '1976-07-25',
    genero: 'F',
    telefono: '+59171234503',
    correo: 'rosa.choque@example.bo',
    estado: 'active',
    elegibilidad: 'eligible',
    alta: '2026-01-20T09:05:00Z',
    carnet: '3095442',
    expedido: 'LP',
    historia: 'Docente. Ingreso fijo y fecha de cobro conocida: la cuota se ajusta al día 25 de cada mes.',
  },
  {
    id: 910004,
    nombre: 'Luis Fernando',
    apellido: 'Gutiérrez Suárez',
    nacimiento: '1998-02-17',
    genero: 'M',
    telefono: '+59171234504',
    correo: 'lf.gutierrez@example.bo',
    estado: 'active',
    elegibilidad: 'eligible',
    alta: '2026-05-08T14:22:00Z',
    carnet: '9182736',
    expedido: 'CB',
    historia: 'Transportista. Ingreso variable; se le aprobó un monto menor al pedido por capacidad, no por antecedentes.',
  },
  {
    id: 910005,
    nombre: 'Andrea',
    apellido: 'Villarroel Peña',
    nacimiento: '1992-09-30',
    genero: 'F',
    telefono: '+59171234505',
    correo: 'andrea.villarroel@example.bo',
    estado: 'active',
    elegibilidad: 'eligible',
    alta: '2026-04-19T11:50:00Z',
    carnet: '6647301',
    expedido: 'SC',
    historia: 'Enfermera. Compró un electrodoméstico en doce cuotas; va por la sexta.',
  },
  {
    id: 910006,
    nombre: 'Gonzalo',
    apellido: 'Terceros Aguilar',
    nacimiento: '1985-12-08',
    genero: 'M',
    telefono: '+59171234506',
    correo: 'gonzalo.terceros@example.bo',
    estado: 'active',
    elegibilidad: 'eligible',
    alta: '2026-02-27T08:31:00Z',
    carnet: '5512098',
    expedido: 'CB',
    historia: 'Albañil independiente. Sin boleta ni extracto: su línea se construyó con el historial de pagos dentro de la red.',
  },
  {
    id: 910007,
    nombre: 'Silvia',
    apellido: 'Mendoza Cuéllar',
    nacimiento: '1996-06-14',
    genero: 'F',
    telefono: '+59171234507',
    correo: 'silvia.mendoza@example.bo',
    estado: 'under_review',
    elegibilidad: null,
    alta: '2026-09-11T19:02:00Z',
    carnet: '8830145',
    expedido: 'SC',
    historia:
      'El nombre del carnet y el de la selfie coinciden, pero la foto salió borrosa y el verificador quedó por debajo del umbral. Espera a una persona.',
  },
  {
    id: 910008,
    nombre: 'Marco Antonio',
    apellido: 'Flores Ticona',
    nacimiento: '1990-03-21',
    genero: 'M',
    telefono: '+59171234508',
    correo: 'marco.flores@example.bo',
    estado: 'observed',
    elegibilidad: 'eligible',
    alta: '2026-06-03T13:15:00Z',
    carnet: '4402917',
    expedido: 'LP',
    historia:
      'Pagó tarde dos cuotas seguidas y luego regularizó. Sigue elegible, pero bajo observación: el próximo atraso cierra la línea.',
  },
  {
    id: 910009,
    nombre: 'Patricia',
    apellido: 'Arce Montaño',
    nacimiento: '1983-10-05',
    genero: 'F',
    telefono: '+59171234509',
    correo: 'patricia.arce@example.bo',
    estado: 'suspended',
    elegibilidad: 'not_eligible',
    alta: '2026-01-09T17:44:00Z',
    carnet: '2971604',
    expedido: 'SC',
    historia: 'Cuota vencida hace 47 días sin contacto exitoso. Suspendida hasta regularizar; el expediente está en cobranza.',
  },
  {
    id: 910010,
    nombre: 'Edwin',
    apellido: 'Callisaya Huanca',
    nacimiento: '2001-01-28',
    genero: 'M',
    telefono: '+59171234510',
    correo: 'edwin.callisaya@example.bo',
    estado: 'rejected',
    elegibilidad: 'not_eligible',
    alta: '2026-08-22T12:08:00Z',
    carnet: '9955012',
    expedido: 'LP',
    historia:
      'Rechazado por capacidad: el ingreso comprobado no sostiene ninguna cuota del catálogo. Puede volver a intentarlo en 60 días.',
  },
  {
    id: 910011,
    nombre: 'Carla',
    apellido: 'Ribera Justiniano',
    nacimiento: '1999-05-19',
    genero: 'F',
    telefono: '+59171234511',
    correo: 'carla.ribera@example.bo',
    estado: 'onboarding_in_progress',
    elegibilidad: null,
    alta: '2026-09-16T21:30:00Z',
    carnet: '7018823',
    expedido: 'SC',
    historia: 'Empezó el alta anoche y dejó a medias la captura del reverso del carnet. No es un fallo: es el embudo real.',
  },
  {
    id: 910012,
    nombre: 'Ramiro',
    apellido: 'Sánchez Ledezma',
    nacimiento: '1987-08-11',
    genero: 'M',
    telefono: '+59171234512',
    correo: 'ramiro.sanchez@example.bo',
    estado: 'blocked',
    elegibilidad: 'not_eligible',
    alta: '2026-07-01T10:00:00Z',
    carnet: '6120394',
    expedido: 'CB',
    historia:
      'Bloqueado tras confirmarse suplantación: el mismo carnet apareció con dos rostros distintos en quince días. Caso de fraude abierto.',
  },
];

function uuidDemo(id: number): string {
  // UUID determinista: la misma persona conserva su identificador entre siembras y entornos, que es
  // lo que permite comparar una pantalla de dev con la misma pantalla de test.
  const sufijo = String(id).padStart(12, '0');
  return `00000000-0000-4000-8000-${sufijo}`;
}

const clientes = PERSONAS.map((p) => ({
  _id: p.id,
  _tenant_id: TENANT_DEMO,
  customer_code: `ATL-${p.id}`,
  customer_uuid: uuidDemo(p.id),
  primary_phone_hash: hashSensitiveText(p.telefono),
  primary_phone_last_4: lastCharacters(p.telefono, 4),
  primary_email_hash: hashSensitiveText(p.correo),
  primary_email_domain: p.correo.split('@')[1],
  lifecycle_status: p.estado,
  credit_eligibility_status: p.elegibilidad,
  eligibility_evaluated_at: p.elegibilidad ? p.alta : null,
  _created_at: p.alta,
  _updated_at: p.alta,
  _deleted: false,
}));

const versionesPerfil = PERSONAS.map((p, indice) => ({
  _id: 910100 + indice,
  _tenant_id: TENANT_DEMO,
  customer_id: p.id,
  first_name: p.nombre,
  last_name: p.apellido,
  full_name_normalized: `${p.nombre} ${p.apellido}`.toLowerCase(),
  birth_date: p.nacimiento,
  age_at_capture: 2026 - Number(p.nacimiento.slice(0, 4)),
  gender_declared: p.genero,
  preferred_language: 'es',
  marketing_opt_in: indice % 3 === 0,
  source_type: 'onboarding_app',
  valid_from: p.alta,
  valid_until: null,
  supersedes_version_id: null,
  _created_at: p.alta,
}));

const contactos = PERSONAS.flatMap((p, indice) => [
  {
    _id: 910300 + indice * 2,
    _tenant_id: TENANT_DEMO,
    customer_id: p.id,
    contact_type: 'phone',
    contact_value_hash: hashSensitiveText(p.telefono),
    normalized_value_hash: hashSensitiveText(p.telefono),
    value_last_4: lastCharacters(p.telefono, 4),
    label: 'Celular declarado en el alta',
    is_primary: true,
    status: 'verified',
    source_type: 'onboarding_app',
    first_seen_at: p.alta,
    last_seen_at: p.alta,
    _created_at: p.alta,
    _updated_at: p.alta,
    _deleted: false,
  },
  {
    _id: 910301 + indice * 2,
    _tenant_id: TENANT_DEMO,
    customer_id: p.id,
    contact_type: 'email',
    contact_value_hash: hashSensitiveText(p.correo),
    normalized_value_hash: hashSensitiveText(p.correo),
    email_domain: p.correo.split('@')[1],
    label: 'Correo declarado en el alta',
    is_primary: true,
    status: p.estado === 'onboarding_in_progress' ? 'pending' : 'verified',
    source_type: 'onboarding_app',
    first_seen_at: p.alta,
    last_seen_at: p.alta,
    _created_at: p.alta,
    _updated_at: p.alta,
    _deleted: false,
  },
]);

const documentos = PERSONAS.map((p, indice) => ({
  _id: 910500 + indice,
  _tenant_id: TENANT_DEMO,
  customer_id: p.id,
  document_type: 'CI',
  declared_number_hash: hashSensitiveText(p.carnet),
  declared_number_last_4: lastCharacters(p.carnet, 4),
  declared_issued_in: p.expedido,
  ocr_full_name: `${p.nombre} ${p.apellido}`.toUpperCase(),
  ocr_birth_date: p.nacimiento,
  ocr_confidence_score: p.estado === 'under_review' ? 0.61 : 0.94,
  verification_status:
    p.estado === 'under_review'
      ? 'manual_review'
      : p.estado === 'onboarding_in_progress'
        ? 'pending'
        : p.estado === 'blocked'
          ? 'rejected'
          : 'verified',
  verified_at: ['under_review', 'onboarding_in_progress', 'blocked'].includes(p.estado) ? null : p.alta,
  issued_at: '2019-05-10',
  expires_at: '2029-05-10',
  valid_from: p.alta,
  valid_until: null,
  _created_at: p.alta,
}));

const eventosEstado = PERSONAS.map((p, indice) => ({
  _id: 910600 + indice,
  _tenant_id: TENANT_DEMO,
  customer_id: p.id,
  previous_status: 'registered',
  new_status: p.estado,
  reason_code:
    p.estado === 'suspended'
      ? 'MORA_VIGENTE'
      : p.estado === 'blocked'
        ? 'FRAUDE_CONFIRMADO'
        : p.estado === 'rejected'
          ? 'CAPACIDAD_INSUFICIENTE'
          : p.estado === 'observed'
            ? 'ATRASO_REITERADO'
            : p.estado === 'under_review'
              ? 'IDENTIDAD_EN_REVISION'
              : 'ALTA_COMPLETADA',
  changed_by_type: ['suspended', 'blocked', 'observed'].includes(p.estado) ? 'internal_user' : 'system',
  happened_at: p.alta,
  notes: p.historia,
  _created_at: p.alta,
}));

export const CLIENTES: DominioSembrado = {
  nombre: 'clientes',
  descripcion: 'Doce personas inventadas con estados de ciclo de vida distintos, su perfil, contactos, documento y bitácora.',
  bloques: [
    { tabla: 'customer.customers', filas: clientes, conflicto: ['_id'] },
    { tabla: 'customer.customer_profile_versions', filas: versionesPerfil },
    { tabla: 'customer.customer_contact_methods', filas: contactos },
    { tabla: 'customer.customer_identity_documents', filas: documentos },
    { tabla: 'customer.customer_status_events', filas: eventosEstado },
  ],
};

/** Los identificadores de las personas, para que los demás dominios apunten a ellas sin repetirlos. */
export const ID_PERSONAS = Object.fromEntries(PERSONAS.map((p) => [p.apellido.split(' ')[0].toLowerCase(), p.id])) as Record<
  string,
  number
>;
export const PERSONAS_DEMO = PERSONAS;
