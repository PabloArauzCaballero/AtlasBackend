/**
 * @file El plantel interno y los usuarios de comercio que aparecen como actores en el portal.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define seeders para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { TENANT_DEMO, type DominioSembrado } from './tipos.js';

/**
 * Identidades SIN credencial, a propósito.
 *
 * Un caso de soporte, una asignación o una decisión de revisión necesitan un actor con nombre para
 * que la pantalla diga quién hizo qué. Crear ADEMÁS una contraseña metería cuentas que pueden
 * entrar al portal en todos los entornos donde corra la siembra, que es exactamente el agujero que
 * nadie quiere heredar. Estas filas se ven y se citan; no abren sesión. El alta de una persona que
 * sí debe entrar se hace desde el portal, con su correo real.
 *
 * Bloque: 930001–930099 internos · 930100–930199 usuarios de comercio · 930200–930299 solicitudes.
 */
const FECHA = '2026-08-01T09:00:00Z';

interface InternoSemilla {
  readonly id: number;
  readonly nombre: string;
  readonly correo: string;
  readonly rol: string;
  readonly area: string;
  readonly cargo: string;
  readonly estado: string;
}

const INTERNOS: InternoSemilla[] = [
  {
    id: 930001,
    nombre: 'Daniela Ortiz Camacho',
    correo: 'daniela.ortiz@atlas.demo',
    rol: 'internal_operator',
    area: 'Soporte',
    cargo: 'Agente de soporte · nivel 1',
    estado: 'active',
  },
  {
    id: 930002,
    nombre: 'Iván Peredo Salazar',
    correo: 'ivan.peredo@atlas.demo',
    rol: 'internal_operator',
    area: 'Soporte',
    cargo: 'Agente de soporte · nivel 2',
    estado: 'active',
  },
  {
    id: 930003,
    nombre: 'Lucía Nogales Ferrufino',
    correo: 'lucia.nogales@atlas.demo',
    rol: 'risk_analyst',
    area: 'Riesgo de crédito',
    cargo: 'Analista de riesgo',
    estado: 'active',
  },
  {
    id: 930004,
    nombre: 'Hugo Zambrana Melgar',
    correo: 'hugo.zambrana@atlas.demo',
    rol: 'fraud_analyst',
    area: 'Seguridad',
    cargo: 'Analista de fraude',
    estado: 'active',
  },
  {
    id: 930005,
    nombre: 'Verónica Aramayo Pinto',
    correo: 'veronica.aramayo@atlas.demo',
    rol: 'compliance_analyst',
    area: 'Cumplimiento',
    cargo: 'Analista de cumplimiento',
    estado: 'active',
  },
  {
    id: 930006,
    nombre: 'Sergio Delgadillo Roca',
    correo: 'sergio.delgadillo@atlas.demo',
    rol: 'internal_operator',
    area: 'Comercios',
    cargo: 'Ejecutivo de comercios',
    estado: 'active',
  },
  {
    id: 930007,
    nombre: 'Paola Iriarte Lima',
    correo: 'paola.iriarte@atlas.demo',
    rol: 'qa_engineer',
    area: 'Calidad',
    cargo: 'Ingeniera de calidad',
    estado: 'active',
  },
  {
    id: 930008,
    nombre: 'Álvaro Cuéllar Roda',
    correo: 'alvaro.cuellar@atlas.demo',
    rol: 'readonly_auditor',
    area: 'Auditoría interna',
    cargo: 'Auditor',
    estado: 'active',
  },
  {
    id: 930009,
    nombre: 'Noelia Espinoza Vargas',
    correo: 'noelia.espinoza@atlas.demo',
    rol: 'internal_operator',
    area: 'Cobranza',
    cargo: 'Gestora de cobranza',
    estado: 'active',
  },
  {
    id: 930010,
    nombre: 'Fabricio Lens Antelo',
    correo: 'fabricio.lens@atlas.demo',
    rol: 'internal_operator',
    area: 'Soporte',
    cargo: 'Agente de soporte · nivel 1',
    estado: 'suspended',
  },
];

const internos = INTERNOS.map((i) => ({
  _id: i.id,
  _tenant_id: TENANT_DEMO,
  user_code: `INT-${i.id}`,
  full_name: i.nombre,
  email: i.correo,
  role_code: i.rol,
  status: i.estado,
  department: i.area,
  job_title: i.cargo,
  must_change_password: false,
  mfa_enabled: true,
  _created_at: FECHA,
  _updated_at: FECHA,
  _deleted: false,
}));

interface ComercianteSemilla {
  readonly id: number;
  readonly comercio: number;
  readonly nombre: string;
  readonly correo: string;
  readonly telefono: string;
  readonly estado: string;
}

const COMERCIANTES: ComercianteSemilla[] = [
  {
    id: 930101,
    comercio: 920001,
    nombre: 'Jorge Saucedo Áñez',
    correo: 'jorge.saucedo@electrohogar.example.bo',
    telefono: '+59171990001',
    estado: 'active',
  },
  {
    id: 930102,
    comercio: 920001,
    nombre: 'Mariela Ortuño Paz',
    correo: 'mariela.ortuno@electrohogar.example.bo',
    telefono: '+59171990002',
    estado: 'active',
  },
  {
    id: 930103,
    comercio: 920002,
    nombre: 'Freddy Colque Mamani',
    correo: 'freddy.colque@elconstructor.example.bo',
    telefono: '+59171990003',
    estado: 'active',
  },
  {
    id: 930104,
    comercio: 920003,
    nombre: 'Elvira Tarqui Condori',
    correo: 'elvira.tarqui@mercaditoandino.example.bo',
    telefono: '+59171990004',
    estado: 'active',
  },
  {
    id: 930105,
    comercio: 920004,
    nombre: 'Kevin Áñez Mercado',
    correo: 'kevin.anez@tecnomovil.example.bo',
    telefono: '+59171990005',
    estado: 'suspended',
  },
  {
    id: 930106,
    comercio: 920005,
    nombre: 'Gabriela Rocha Silva',
    correo: 'gabriela.rocha@vidasana.example.bo',
    telefono: '+59171990006',
    estado: 'invited',
  },
];

const comerciantes = COMERCIANTES.map((c) => ({
  _id: c.id,
  _tenant_id: TENANT_DEMO,
  user_code: `MER-${c.id}`,
  full_name: c.nombre,
  email: c.correo,
  role_code: 'merchant',
  status: c.estado,
  phone: c.telefono,
  must_change_password: c.estado === 'invited',
  mfa_enabled: false,
  _created_at: FECHA,
  _updated_at: FECHA,
  _deleted: false,
}));

const solicitudes = [
  {
    _id: 930201,
    _tenant_id: TENANT_DEMO,
    source: 'erp',
    external_reference: 'ERP-REQ-20260914-001',
    account_reference: 'ERP-920001',
    account_name: 'Electrohogar Santa Cruz S.R.L.',
    branch_name: 'Sucursal norte',
    email: 'cajanorte@electrohogar.example.bo',
    full_name: 'Rocío Melgar Justiniano',
    phone: '+59171990007',
    role_code: 'merchant',
    requested_by: 'erp:sergio.delgadillo',
    requested_at: '2026-09-14T15:20:00Z',
    status: 'pending',
    _created_at: '2026-09-14T15:20:00Z',
    _updated_at: '2026-09-14T15:20:00Z',
  },
  {
    _id: 930202,
    _tenant_id: TENANT_DEMO,
    source: 'erp',
    external_reference: 'ERP-REQ-20260910-004',
    account_reference: 'ERP-920003',
    account_name: 'Distribuidora Andina de Alimentos S.A.',
    branch_name: 'Casa matriz',
    email: 'elvira.tarqui@mercaditoandino.example.bo',
    full_name: 'Elvira Tarqui Condori',
    phone: '+59171990004',
    role_code: 'merchant',
    requested_by: 'erp:sergio.delgadillo',
    requested_at: '2026-09-10T11:05:00Z',
    status: 'provisioned',
    merchant_user_id: 930104,
    decided_at: '2026-09-10T12:40:00Z',
    _created_at: '2026-09-10T11:05:00Z',
    _updated_at: '2026-09-10T12:40:00Z',
  },
  {
    _id: 930203,
    _tenant_id: TENANT_DEMO,
    source: 'erp',
    external_reference: 'ERP-REQ-20260908-011',
    account_reference: 'ERP-920007',
    account_name: 'Repuestos del Sur S.R.L.',
    branch_name: 'Casa matriz',
    email: 'ventas@repuestosdelsur.example.bo',
    full_name: 'Wilson Áñez Suárez',
    phone: '+59171990008',
    role_code: 'merchant',
    requested_by: 'erp:sergio.delgadillo',
    requested_at: '2026-09-08T09:15:00Z',
    status: 'rejected',
    decided_at: '2026-09-08T16:00:00Z',
    rejection_reason: 'El comercio no está aprobado: su alta fue rechazada por NIT no vigente.',
    _created_at: '2026-09-08T09:15:00Z',
    _updated_at: '2026-09-08T16:00:00Z',
  },
];

export const EQUIPO: DominioSembrado = {
  nombre: 'equipo',
  descripcion: 'Plantel interno sin credencial, usuarios de comercio y las solicitudes de alta que llegan del ERP.',
  bloques: [
    { tabla: 'iam.internal_users', filas: internos },
    { tabla: 'iam.merchant_users', filas: comerciantes },
    { tabla: 'iam.merchant_user_provisioning_requests', filas: solicitudes },
  ],
};

export const ID_INTERNOS = {
  soporteL1: 930001,
  soporteL2: 930002,
  riesgo: 930003,
  fraude: 930004,
  cumplimiento: 930005,
  comercios: 930006,
  calidad: 930007,
  auditoria: 930008,
  cobranza: 930009,
};
