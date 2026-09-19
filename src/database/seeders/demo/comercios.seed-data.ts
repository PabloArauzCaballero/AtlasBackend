/**
 * @file Comercios de la red: ocho afiliados en estados de alta distintos, con sucursales y QR.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define seeders para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { TENANT_DEMO, type DominioSembrado } from './tipos.js';

/**
 * Bloque: 920001–920099 comercios · 920100–920299 sucursales · 920300–920399 QR ·
 * 920400–920499 terminales · 920500–920599 representantes legales.
 *
 * Los NIT son inventados y empiezan por 99 para que no puedan confundirse con uno real ni chocar
 * con los que ya estén en la base de desarrollo.
 */
interface ComercioSemilla {
  readonly id: number;
  readonly razon: string;
  readonly nombre: string;
  readonly nit: string;
  readonly rubro: string;
  readonly correo: string;
  readonly telefono: string;
  readonly estado: string;
  readonly ciudad: string;
  readonly direccion: string;
  readonly lat: number;
  readonly lon: number;
  readonly mdr: number;
  readonly desenlace: string | null;
  readonly motivo: string | null;
  readonly nota: string;
}

const COMERCIOS: ComercioSemilla[] = [
  {
    id: 920001,
    razon: 'Electrohogar Santa Cruz S.R.L.',
    nombre: 'Electrohogar',
    nit: '9900010018',
    rubro: 'ELECTRODOMESTICOS',
    correo: 'ventas@electrohogar.example.bo',
    telefono: '+59133445501',
    estado: 'approved',
    ciudad: 'Santa Cruz de la Sierra',
    direccion: 'Av. Cañoto esq. Ballivián #145',
    lat: -17.784,
    lon: -63.182,
    mdr: 3.5,
    desenlace: 'APPROVED',
    motivo: null,
    nota: 'El comercio con más volumen de la red. Tres sucursales y el ticket promedio más alto.',
  },
  {
    id: 920002,
    razon: 'Ferretería El Constructor Ltda.',
    nombre: 'El Constructor',
    nit: '9900020026',
    rubro: 'FERRETERIA',
    correo: 'contacto@elconstructor.example.bo',
    telefono: '+59133445502',
    estado: 'approved',
    ciudad: 'Santa Cruz de la Sierra',
    direccion: 'Av. Grigotá #2210',
    lat: -17.798,
    lon: -63.203,
    mdr: 3.0,
    desenlace: 'APPROVED',
    motivo: null,
    nota: 'Ticket medio y devoluciones casi nulas: el rubro más previsible de la cartera.',
  },
  {
    id: 920003,
    razon: 'Distribuidora Andina de Alimentos S.A.',
    nombre: 'Mercadito Andino',
    nit: '9900030034',
    rubro: 'ABARROTES',
    correo: 'admin@mercaditoandino.example.bo',
    telefono: '+59122445503',
    estado: 'approved',
    ciudad: 'La Paz',
    direccion: 'C. Sagárnaga #345',
    lat: -16.496,
    lon: -68.138,
    mdr: 2.5,
    desenlace: 'APPROVED',
    motivo: null,
    nota: 'Compras pequeñas y diarias. Es el que mejor mide si la app sirve para el día a día.',
  },
  {
    id: 920004,
    razon: 'TecnoMóvil Bolivia S.R.L.',
    nombre: 'TecnoMóvil',
    nit: '9900040042',
    rubro: 'TECNOLOGIA',
    correo: 'gerencia@tecnomovil.example.bo',
    telefono: '+59133445504',
    estado: 'approved',
    ciudad: 'Santa Cruz de la Sierra',
    direccion: 'Av. San Martín #500, Equipetrol',
    lat: -17.767,
    lon: -63.196,
    mdr: 4.0,
    desenlace: 'APPROVED',
    motivo: null,
    nota: 'Rubro vigilado: aquí es donde aparece el crédito que termina en reventa.',
  },
  {
    id: 920005,
    razon: 'Farmacia Vida Sana S.R.L.',
    nombre: 'Vida Sana',
    nit: '9900050050',
    rubro: 'SALUD_OPTICA',
    correo: 'farmacia@vidasana.example.bo',
    telefono: '+59144445505',
    estado: 'pending_review',
    ciudad: 'Cochabamba',
    direccion: 'Av. América #1180',
    lat: -17.379,
    lon: -66.158,
    mdr: 3.0,
    desenlace: 'MANUAL_REVIEW',
    motivo: 'DOCUMENTO_ILEGIBLE',
    nota: 'El QR de cobro que subieron salió cortado: no se lee la entidad. Está esperando revisión humana.',
  },
  {
    id: 920006,
    razon: 'Confecciones Nuevo Amanecer',
    nombre: 'Nuevo Amanecer',
    nit: '9900060069',
    rubro: 'ROPA_CALZADO',
    correo: 'contacto@nuevoamanecer.example.bo',
    telefono: '+59122445506',
    estado: 'submitted',
    ciudad: 'El Alto',
    direccion: 'Av. 6 de Marzo Km 4',
    lat: -16.518,
    lon: -68.181,
    mdr: 3.5,
    desenlace: null,
    motivo: null,
    nota: 'Solicitud recién enviada, todavía sin decidir. Es lo que debe verse en la bandeja de alta.',
  },
  {
    id: 920007,
    razon: 'Repuestos del Sur S.R.L.',
    nombre: 'Repuestos del Sur',
    nit: '9900070077',
    rubro: 'SERVICIOS_MOVILIDAD',
    correo: 'ventas@repuestosdelsur.example.bo',
    telefono: '+59133445507',
    estado: 'rejected',
    ciudad: 'Santa Cruz de la Sierra',
    direccion: 'Av. Virgen de Cotoca #890',
    lat: -17.775,
    lon: -63.148,
    mdr: 3.5,
    desenlace: 'REJECTED',
    motivo: 'NIT_NO_VIGENTE',
    nota: 'Rechazado: el NIT declarado no figura vigente. Puede volver a presentarse con el registro al día.',
  },
  {
    id: 920008,
    razon: 'Restaurante Doña Elvira',
    nombre: 'Doña Elvira',
    nit: '9900080085',
    rubro: 'RESTAURANTE',
    correo: 'reservas@donaelvira.example.bo',
    telefono: '+59144445508',
    estado: 'draft',
    ciudad: 'Cochabamba',
    direccion: 'C. España #240',
    lat: -17.392,
    lon: -66.157,
    mdr: 2.5,
    desenlace: null,
    motivo: null,
    nota: 'Empezó el formulario y no lo terminó. Sirve para ver que un borrador no aparece como solicitud.',
  },
];

const FECHA = '2026-09-05T12:00:00Z';

/**
 * El primer usuario sembrado de cada comercio, que es quien figura como dueño de su expediente.
 *
 * Se declara aquí y no se importa de `equipo.seed-data.ts` para no cruzar los dos módulos de
 * siembra —cada uno se puede sembrar por separado—; los identificadores son constantes fijas del
 * bloque 930100–930199 y `equipo` los declara con su `comercio`. Si se añade un comercio con
 * usuarios, se añade aquí su primera línea.
 */
const DUENO_POR_COMERCIO: Readonly<Record<number, number>> = {
  920001: 930101,
  920002: 930103,
  920003: 930104,
  920004: 930105,
  920005: 930106,
};

const comercios = COMERCIOS.map((c) => ({
  _id: c.id,
  _tenant_id: TENANT_DEMO,
  legal_name: c.razon,
  trade_name: c.nombre,
  tax_id: c.nit,
  commercial_registry: `FUNDEMPRESA-${c.nit.slice(2, 8)}`,
  business_category: c.rubro,
  contact_email: c.correo,
  contact_phone: c.telefono,
  email_verified_at: c.estado === 'draft' ? null : FECHA,
  phone_verified_at: c.estado === 'draft' ? null : FECHA,
  onboarding_status: c.estado,
  submitted_at: ['draft'].includes(c.estado) ? null : FECHA,
  decided_at: ['approved', 'rejected'].includes(c.estado) ? FECHA : null,
  rejection_reason: c.estado === 'rejected' ? 'El NIT declarado no figura vigente en el padrón del SIN.' : null,
  erp_account_id: c.estado === 'approved' ? `ERP-${c.id}` : null,
  /*
   * DUEÑO del expediente, y sin él la siembra nace inservible.
   *
   * `GET /partner-onboarding/mine` —lo primero que pide cada pantalla del portal del comercio—
   * busca por esta columna. Sembrada en `null`, un comercio sembrado entra a su portal y TODO le
   * dice «su comercio todavía no tiene expediente en Atlas»: no ve su cartera, ni su facturación,
   * ni sus sucursales, ni dónde subir su QR. Se descubrió en TEST el 2026-09-18, con ocho
   * comercios en la base y el portal entero en su estado vacío.
   *
   * El dueño es el PRIMER usuario del comercio en `equipo.seed-data.ts`, que ya declara a qué
   * comercio pertenece cada uno. Un comercio sin usuarios sembrados se queda sin dueño, que es
   * correcto: no hay nadie que pudiera entrar.
   */
  owner_merchant_user_id: DUENO_POR_COMERCIO[c.id] ?? null,
  mdr_rate_percent: c.mdr,
  decision_outcome: c.desenlace,
  decision_reason: c.motivo,
  decision_artifact_version: c.desenlace ? 'partner-onboarding@2026.2' : null,
  decision_evaluated_at: c.desenlace ? FECHA : null,
  _created_at: FECHA,
  _updated_at: FECHA,
  _deleted: false,
}));

const sucursales = COMERCIOS.filter((c) => c.estado === 'approved').flatMap((c, indice) => {
  const base = 920100 + indice * 3;
  const principal = {
    _id: base,
    _tenant_id: TENANT_DEMO,
    partner_profile_id: c.id,
    branch_code: 'CASA-MATRIZ',
    name: `${c.nombre} · casa matriz`,
    address_line: c.direccion,
    city: c.ciudad,
    latitude: c.lat,
    longitude: c.lon,
    status: 'active',
    erp_branch_id: `ERPB-${base}`,
    _created_at: FECHA,
    _updated_at: FECHA,
  };
  if (c.id !== 920001) return [principal];
  return [
    principal,
    {
      ...principal,
      _id: base + 1,
      branch_code: 'SUC-NORTE',
      name: `${c.nombre} · sucursal norte`,
      address_line: 'Av. Banzer 3er anillo #77',
      latitude: -17.752,
      longitude: -63.178,
      erp_branch_id: `ERPB-${base + 1}`,
    },
    {
      ...principal,
      _id: base + 2,
      branch_code: 'SUC-PLAN3000',
      name: `${c.nombre} · sucursal Plan 3000`,
      address_line: 'Av. Paurito, mercado La Pampa',
      latitude: -17.831,
      longitude: -63.107,
      status: 'inactive',
      erp_branch_id: `ERPB-${base + 2}`,
    },
  ];
});

const qrs = COMERCIOS.filter((c) => ['approved', 'pending_review'].includes(c.estado)).map((c, indice) => ({
  _id: 920300 + indice,
  _tenant_id: TENANT_DEMO,
  partner_profile_id: c.id,
  branch_id: null,
  qr_kind: 'bank',
  storage_key: `demo/qr/${c.id}-cobro.png`,
  content_type: 'image/png',
  size_bytes: 48_120 + indice * 311,
  sha256: `demo${String(c.id).padStart(60, '0')}`,
  bank_institution_code: indice % 2 === 0 ? 'BNB' : 'BMSC',
  account_number_masked: `****${String(4200 + indice)}`,
  status: c.estado === 'approved' ? 'active' : 'pending_review',
  verified_at: c.estado === 'approved' ? FECHA : null,
  review_note:
    c.estado === 'approved' ? 'Entidad y titular coinciden con la razón social.' : 'La imagen llega cortada: no se lee la entidad emisora.',
  _created_at: FECHA,
  _updated_at: FECHA,
}));

export const COMERCIOS_DEMO: DominioSembrado = {
  nombre: 'comercios',
  descripcion: 'Ocho comercios afiliados en estados de alta distintos, con sus sucursales y el QR de cobro.',
  bloques: [
    { tabla: 'partner.partner_profiles', filas: comercios },
    { tabla: 'partner.partner_branches', filas: sucursales },
    { tabla: 'partner.partner_qr_codes', filas: qrs },
  ],
};

export const ID_COMERCIOS = COMERCIOS.map((c) => c.id);
