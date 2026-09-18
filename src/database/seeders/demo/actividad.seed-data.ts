/**
 * @file Actividad observada: salud de proveedores, señales de riesgo y telemetría.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define seeders para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { refA, TENANT_DEMO, type DominioSembrado, type FilaSembrada } from './tipos.js';

/**
 * Bloque: 992001–992199 salud de proveedores · 992200–992299 señales · 992300–992499 telemetría.
 *
 * **Los expedientes NO se siembran aquí, y es deliberado.** Las concesiones y los tickets de subida
 * apuntan a carpetas y expedientes que este seeder no crea, así que llevaban identificadores de una
 * base concreta: el despliegue de una base limpia murió con
 * «violates foreign key constraint expediente_concesiones_nodo_id_fkey». Y sembrar el expediente
 * entero tampoco vale: sus nodos de archivo apuntan a objetos de MinIO que en un entorno nuevo no
 * existen, así que la pantalla listaría documentos que no se pueden abrir — peor que una vacía.
 * Un expediente de demostración necesita sembrar TAMBIÉN sus bytes, y eso es un cambio propio.
 */
const T = TENANT_DEMO;

const PROVEEDORES = [
  { code: 'SEGIP', latencia: 380, estado: 'healthy', nota: 'Padrón de identidad. Responde estable en horario hábil.' },
  { code: 'INFOCENTER', latencia: 920, estado: 'degraded', nota: 'Buró de crédito. Latencia por encima del objetivo desde el martes.' },
  { code: 'QR_GENERIC', latencia: 140, estado: 'healthy', nota: 'Generación de QR de cobro.' },
  { code: 'BANKING_GENERIC', latencia: 610, estado: 'healthy', nota: 'Consulta de movimientos para el extracto.' },
  { code: 'TELCO_GENERIC', latencia: 210, estado: 'healthy', nota: 'Entrega de mensajes de texto.' },
  {
    code: 'FACEBOOK_META',
    latencia: 0,
    estado: 'down',
    nota: 'Sin credenciales configuradas en este entorno: no es una caída del proveedor.',
  },
  { code: 'WHATSAPP_GENERIC', latencia: 330, estado: 'healthy', nota: 'Mensajería alternativa.' },
  { code: 'DIGITAL_TRUST_GENERIC', latencia: 480, estado: 'healthy', nota: 'Señales de confianza del dispositivo.' },
];

/** Doce horas de sondeos, uno por hora, para que la pantalla de salud tenga una curva y no un punto. */
const saludProveedores: FilaSembrada[] = [];
let idSalud = 992001;
for (const [indiceProveedor, proveedor] of PROVEEDORES.entries()) {
  for (let hora = 0; hora < 12; hora += 1) {
    const marca = `2026-09-17T${String(6 + hora).padStart(2, '0')}:00:00Z`;
    // El buró se degrada a media mañana y se recupera: una curva plana no permite comprobar la alerta.
    const degradado = proveedor.code === 'INFOCENTER' && hora >= 4 && hora <= 8;
    const caido = proveedor.estado === 'down';
    saludProveedores.push({
      _id: idSalud++,
      provider_id: refA('integrations.data_providers', { provider_code: proveedor.code }),
      status: caido ? 'down' : degradado ? 'degraded' : 'healthy',
      mode_checked: 'mock',
      latency_ms: caido
        ? 0
        : degradado
          ? proveedor.latencia + 700 + hora * 40
          : proveedor.latencia + ((indiceProveedor * 7 + hora * 13) % 60),
      checked_at: marca,
      error_code: caido ? 'CREDENCIALES_AUSENTES' : degradado ? 'LATENCIA_SOBRE_OBJETIVO' : null,
      error_message_safe: caido
        ? 'No hay credenciales configuradas para este proveedor en este entorno.'
        : degradado
          ? 'El proveedor responde, pero por encima del objetivo de latencia acordado.'
          : null,
      metadata_json: { nota: proveedor.nota },
    });
  }
}

interface SenalSemilla {
  readonly id: number;
  readonly code: string;
  readonly nombre: string;
  readonly tipo: string;
  readonly origen: string;
  readonly destino: string;
  readonly dimension: string;
  readonly prioridad: string;
  readonly direccion: string;
  readonly ejemplo: Record<string, unknown>;
  readonly porQue: string;
}

const SENALES: SenalSemilla[] = [
  {
    id: 992201,
    code: 'PAGOS_PUNTUALES_RED',
    nombre: 'Cuotas pagadas a tiempo dentro de la red',
    tipo: 'agregado',
    origen: 'credit.loan_installments',
    destino: 'historial_pago_interno',
    dimension: 'credito',
    prioridad: 'alta',
    direccion: 'menor_riesgo',
    ejemplo: { cuotasPagadas: 9, aTiempo: 9, ventana: '12 meses' },
    porQue: 'Es la señal más predictiva que tenemos y la única que no depende de que otro nos cuente algo del cliente.',
  },
  {
    id: 992202,
    code: 'DIAS_ATRASO_MAXIMO',
    nombre: 'Peor atraso histórico',
    tipo: 'agregado',
    origen: 'credit.loans',
    destino: 'historial_pago_interno',
    dimension: 'credito',
    prioridad: 'alta',
    direccion: 'mayor_riesgo',
    ejemplo: { peorAtrasoDias: 12, ventana: '24 meses' },
    porQue: 'Un atraso de tres días y uno de noventa no significan lo mismo; el promedio los confunde y el máximo no.',
  },
  {
    id: 992203,
    code: 'RATIO_CUOTA_INGRESO',
    nombre: 'Cuánto del ingreso se lleva la cuota',
    tipo: 'derivado',
    origen: 'credit.credit_lines',
    destino: 'ingreso_declarado',
    dimension: 'capacidad',
    prioridad: 'alta',
    direccion: 'mayor_riesgo',
    ejemplo: { cuota: 420, ingreso: 3200, ratio: 0.13 },
    porQue: 'La capacidad de pago no es el ingreso sino lo que queda después de vivir. Este ratio es la puerta de entrada a esa cuenta.',
  },
  {
    id: 992204,
    code: 'DISPOSITIVO_MULTIUSUARIO',
    nombre: 'El dispositivo aparece en varias cuentas',
    tipo: 'evento',
    origen: 'telemetry.global_device_fingerprints',
    destino: 'dispositivo_compartido',
    dimension: 'fraude',
    prioridad: 'alta',
    direccion: 'mayor_riesgo',
    ejemplo: { cuentasDistintas: 9, ventanaHoras: 72 },
    porQue: 'Un teléfono familiar compartido es normal; nueve altas en tres días desde el mismo aparato no lo es.',
  },
  {
    id: 992205,
    code: 'DISTANCIA_A_DOMICILIO',
    nombre: 'Distancia entre la compra y el domicilio declarado',
    tipo: 'derivado',
    origen: 'telemetry.customer_location_pings',
    destino: 'ubicacion_domicilio',
    dimension: 'fraude',
    prioridad: 'media',
    direccion: 'mayor_riesgo',
    ejemplo: { metros: 18400, comercio: 'TecnoMóvil' },
    porQue: 'Por sí sola no prueba nada —la gente viaja—, pero combinada con dispositivo nuevo y compra grande sí cambia la foto.',
  },
  {
    id: 992206,
    code: 'ANTIGUEDAD_EN_RED',
    nombre: 'Tiempo desde el alta',
    tipo: 'derivado',
    origen: 'customer.customers',
    destino: 'historial_pago_interno',
    dimension: 'credito',
    prioridad: 'media',
    direccion: 'menor_riesgo',
    ejemplo: { dias: 216 },
    porQue:
      'La antigüedad sin comportamiento no dice nada, pero da contexto a las demás señales: dos meses no permiten concluir lo mismo que dos años.',
  },
  {
    id: 992207,
    code: 'REINTENTOS_IDENTIDAD',
    nombre: 'Intentos fallidos de verificación',
    tipo: 'evento',
    origen: 'customer.identity_verification_attempts',
    destino: 'similitud_rostro_documento',
    dimension: 'fraude',
    prioridad: 'media',
    direccion: 'mayor_riesgo',
    ejemplo: { intentos: 3, confianzaMedia: 0.61 },
    porQue:
      'Tres intentos pueden ser mala luz o pueden ser alguien probando con un documento ajeno. Nunca decide solo: abre revisión humana.',
  },
];

const senales = SENALES.map((s) => ({
  _id: s.id,
  signal_code: s.code,
  signal_name: s.nombre,
  signal_type: s.tipo,
  source_entity: s.origen,
  target_definition_code: s.destino,
  risk_dimension: s.dimension,
  build_phase: 'produccion',
  priority: s.prioridad,
  expected_direction: s.direccion,
  example_value_json: s.ejemplo,
  rationale: s.porQue,
  is_active: true,
  _created_at: '2026-06-01T00:00:00Z',
  _updated_at: '2026-06-01T00:00:00Z',
}));

const ubicaciones: FilaSembrada[] = [];
let idUbicacion = 992301;
const RECORRIDO = [
  { cliente: 910001, lat: -17.7845, lng: -63.182, distancia: 120, modo: 'session_start' },
  { cliente: 910001, lat: -17.7852, lng: -63.1798, distancia: 380, modo: 'foreground' },
  { cliente: 910002, lat: -17.7981, lng: -63.2031, distancia: 90, modo: 'session_start' },
  { cliente: 910003, lat: -16.4962, lng: -68.1385, distancia: 45, modo: 'session_start' },
  { cliente: 910004, lat: -17.3791, lng: -66.158, distancia: 210, modo: 'foreground' },
  { cliente: 910008, lat: -16.518, lng: -68.1812, distancia: 1560, modo: 'background' },
  { cliente: 910012, lat: -17.767, lng: -63.1961, distancia: 18_400, modo: 'session_start' },
];
for (const [indice, punto] of RECORRIDO.entries()) {
  ubicaciones.push({
    _id: idUbicacion++,
    _tenant_id: T,
    customer_id: punto.cliente,
    gps_lat: punto.lat,
    gps_lng: punto.lng,
    gps_accuracy_meters: 12 + indice,
    capture_mode: punto.modo,
    is_mocked: false,
    battery_level: 0.4 + indice * 0.07,
    distance_to_declared_meters: punto.distancia,
    captured_at: `2026-09-1${6 + (indice % 2)}T1${indice}:20:00Z`,
    received_at: `2026-09-1${6 + (indice % 2)}T1${indice}:20:05Z`,
    _created_at: `2026-09-1${6 + (indice % 2)}T1${indice}:20:05Z`,
  });
}

const RIESGOS_DISPOSITIVO = [
  {
    id: 992401,
    tipo: 'multiples_cuentas',
    previo: 'trusted',
    nuevo: 'suspicious',
    razon: 'CUENTAS_MULTIPLES',
    evidencia: { cuentasDistintas: 9, ventanaHoras: 72 },
    cuando: '2026-09-16T22:40:00Z',
  },
  {
    id: 992402,
    tipo: 'rostro_discrepante',
    previo: 'suspicious',
    nuevo: 'blocked',
    razon: 'SUPLANTACION_CONFIRMADA',
    evidencia: { similitudRostro: 0.31, umbral: 0.78 },
    cuando: '2026-09-16T23:50:00Z',
  },
  {
    id: 992403,
    tipo: 'primer_uso',
    previo: null,
    nuevo: 'unknown',
    razon: 'DISPOSITIVO_NUEVO',
    evidencia: { primeraVez: true },
    cuando: '2026-09-16T21:05:00Z',
  },
];

const riesgosDispositivo = RIESGOS_DISPOSITIVO.map((r) => ({
  _id: r.id,
  _tenant_id: T,
  event_type: r.tipo,
  previous_risk_status: r.previo,
  new_risk_status: r.nuevo,
  reason_code: r.razon,
  supporting_evidence_json: r.evidencia,
  happened_at: r.cuando,
  _created_at: r.cuando,
}));

const REPUTACION_IP = [
  {
    id: 992451,
    cliente: 910012,
    ip: '181.115.44.210',
    vpn: false,
    proxy: false,
    tor: false,
    pais: 'BO',
    ciudad: 'La Paz',
    puntaje: 0.42,
    cuando: '2026-09-16T23:10:00Z',
  },
  {
    id: 992452,
    cliente: 910001,
    ip: '190.129.12.44',
    vpn: false,
    proxy: false,
    tor: false,
    pais: 'BO',
    ciudad: 'Santa Cruz de la Sierra',
    puntaje: 0.93,
    cuando: '2026-09-17T09:12:00Z',
  },
  {
    id: 992453,
    cliente: 910010,
    ip: '45.132.88.17',
    vpn: true,
    proxy: true,
    tor: false,
    pais: 'US',
    ciudad: 'Ashburn',
    puntaje: 0.18,
    cuando: '2026-08-22T11:40:00Z',
  },
];

const reputacionIp = REPUTACION_IP.map((r) => ({
  _id: r.id,
  _tenant_id: T,
  customer_id: r.cliente,
  ip_address: r.ip,
  is_vpn: r.vpn,
  is_proxy: r.proxy,
  is_tor: r.tor,
  country_code: r.pais,
  city: r.ciudad,
  reputation_score: r.puntaje,
  captured_at: r.cuando,
  _created_at: r.cuando,
}));

export const ACTIVIDAD: DominioSembrado = {
  nombre: 'actividad',
  descripcion:
    'Doce horas de salud por proveedor, siete señales de riesgo explicadas, telemetría de ubicación y dispositivo, y las concesiones y tickets de los expedientes.',
  bloques: [
    { tabla: 'integrations.provider_health_logs', filas: saludProveedores },
    { tabla: 'risk.risk_signal_seeds', filas: senales },
    { tabla: 'telemetry.customer_location_pings', filas: ubicaciones },
    { tabla: 'telemetry.device_risk_events', filas: riesgosDispositivo },
    { tabla: 'telemetry.ip_reputation_observations', filas: reputacionIp },
  ],
};
