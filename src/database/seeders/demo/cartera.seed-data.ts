/**
 * @file La cartera: productos, líneas, solicitudes, préstamos, cuotas y pagos que cuadran entre sí.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define seeders para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { TENANT_DEMO, type DominioSembrado, type FilaSembrada } from './tipos.js';

/**
 * El plan de cuotas se CALCULA, no se escribe a mano.
 *
 * Una cartera sembrada a ojo se delata en la primera pantalla: el saldo no es el capital menos lo
 * pagado, la suma de las cuotas no da el préstamo y los días de atraso no corresponden a ninguna
 * fecha. Aquí el préstamo define capital, plazo y tasa, y de ahí salen las cuotas, los pagos y los
 * totales; lo que la pantalla muestre va a cuadrar porque se derivó del mismo sitio.
 *
 * Bloque: 950001–950099 productos y políticas · 950100–950199 líneas · 950200–950299 solicitudes ·
 * 950300–950399 préstamos · 950400–950999 cuotas · 951000–951299 pagos e imputaciones ·
 * 951300–951499 eventos y calificaciones.
 */
const T = TENANT_DEMO;

const PRODUCTOS = [
  {
    _id: 950001,
    product_code: 'CONSUMO_CORTO',
    product_name: 'Consumo corto',
    currency_code: 'BOB',
    min_amount: 300,
    max_amount: 3000,
    min_term_months: 1,
    max_term_months: 3,
    annual_interest_rate: 18,
    min_monthly_income: 1500,
    requires_manual_review: false,
    status: 'active',
    description:
      'La compra del día a día en un comercio de la red, devuelta en una a tres cuotas. Es la puerta de entrada: casi todo el mundo empieza aquí.',
  },
  {
    _id: 950002,
    product_code: 'CUOTAS_6',
    product_name: 'Seis cuotas',
    currency_code: 'BOB',
    min_amount: 1000,
    max_amount: 12000,
    min_term_months: 4,
    max_term_months: 6,
    annual_interest_rate: 22,
    min_monthly_income: 2500,
    requires_manual_review: false,
    status: 'active',
    description: 'Electrodomésticos, herramientas y equipos. Medio plazo, con cuota fija mensual.',
  },
  {
    _id: 950003,
    product_code: 'CUOTAS_12',
    product_name: 'Doce cuotas',
    currency_code: 'BOB',
    min_amount: 3000,
    max_amount: 30000,
    min_term_months: 7,
    max_term_months: 12,
    annual_interest_rate: 24,
    min_monthly_income: 4000,
    requires_manual_review: true,
    status: 'active',
    description:
      'El tramo alto. Exige revisión humana porque el monto y el plazo dejan poco margen de error si la capacidad se estimó mal.',
  },
  {
    _id: 950004,
    product_code: 'ESTACIONAL_COSECHA',
    product_name: 'Estacional de cosecha',
    currency_code: 'BOB',
    min_amount: 2000,
    max_amount: 20000,
    min_term_months: 6,
    max_term_months: 12,
    annual_interest_rate: 20,
    min_monthly_income: 0,
    requires_manual_review: true,
    status: 'draft',
    description:
      'Borrador para productores: cuotas pequeñas durante el ciclo y una grande en cosecha. Todavía sin aprobar porque el calendario de cobro no está resuelto.',
  },
];

const POLITICAS_MORA = [
  {
    _id: 950051,
    policy_code: 'MORA_ESTANDAR',
    version_code: '2026.1',
    title: 'Política de mora estándar',
    source_kind: 'atlas',
    summary: 'Qué hace Atlas desde el primer día de atraso hasta el castigo de la operación, y qué NO hace nunca.',
    body_md:
      '## Tramos\n\n| Días | Qué pasa |\n|---|---|\n| 1–3 | Recordatorio por la app. Sin cargo. |\n| 4–15 | Llamada del equipo de cobranza y cargo por mora del 2 % sobre la cuota. |\n| 16–45 | Línea suspendida. Se ofrece plan de pago. |\n| 46–90 | Gestión en terreno donde haya cobertura. |\n| 91+ | La operación se castiga contablemente. La deuda sigue existiendo. |\n\n## Lo que no se hace\n\nNo se contacta a terceros que no sean referencias declaradas por la persona, no se visita el domicilio sin aviso previo y no se usa lenguaje intimidatorio. Un incumplimiento de esto es falta grave del agente, no un exceso de celo.',
    stages_json: [
      { dias: '1-3', accion: 'recordatorio' },
      { dias: '4-15', accion: 'llamada+cargo' },
      { dias: '16-45', accion: 'suspension' },
      { dias: '46-90', accion: 'terreno' },
      { dias: '91+', accion: 'castigo' },
    ],
    effective_from: '2026-01-01',
    status: 'active',
    language: 'es',
  },
  {
    _id: 950052,
    policy_code: 'MORA_PRIMER_CREDITO',
    version_code: '2026.1',
    title: 'Tolerancia del primer crédito',
    source_kind: 'atlas',
    summary: 'Quien atrasa por primera vez en su primer crédito no entra en el tramo con cargo hasta el día 8.',
    body_md:
      'La primera experiencia de crédito de una persona suele fallar por desconocimiento de la fecha, no por incapacidad de pago. Medido en la cartera: el 71 % de los primeros atrasos se regulariza dentro de la primera semana sin ninguna gestión.\n\nPor eso el tramo con cargo empieza el día **8** y no el 4, **una sola vez** y sólo en el primer crédito.',
    stages_json: [{ dias: '1-7', accion: 'recordatorio sin cargo' }],
    effective_from: '2026-03-01',
    status: 'active',
    language: 'es',
  },
  {
    _id: 950053,
    policy_code: 'MORA_ESTANDAR',
    version_code: '2025.2',
    title: 'Política de mora estándar (anterior)',
    source_kind: 'atlas',
    summary: 'Versión anterior, conservada porque hay operaciones vivas que se originaron bajo ella.',
    body_md:
      'Idéntica a 2026.1 salvo el cargo por mora, que era del 3 % y bajó al 2 % tras medir que no cambiaba el comportamiento de pago y sí el número de reclamos.',
    stages_json: [],
    effective_from: '2025-06-01',
    effective_until: '2025-12-31',
    status: 'retired',
    language: 'es',
  },
];

interface PrestamoSemilla {
  readonly id: number;
  readonly cliente: number;
  readonly producto: number;
  readonly comercio: number;
  readonly capital: number;
  readonly tasa: number;
  readonly plazo: number;
  readonly desembolso: string;
  readonly primerVence: string;
  readonly cuotasPagadas: number;
  readonly atraso: number;
  readonly estado: string;
  readonly destino: string;
  readonly nota: string;
}

const PRESTAMOS: PrestamoSemilla[] = [
  {
    id: 950301,
    cliente: 910001,
    producto: 950002,
    comercio: 920001,
    capital: 4800,
    tasa: 22,
    plazo: 6,
    desembolso: '2026-04-10T15:00:00Z',
    primerVence: '2026-05-10',
    cuotasPagadas: 6,
    atraso: 0,
    estado: 'paid_off',
    destino: 'ELECTRODOMESTICO_HOGAR',
    nota: 'Refrigerador. Pagado completo y antes de tiempo en las dos últimas cuotas.',
  },
  {
    id: 950302,
    cliente: 910001,
    producto: 950003,
    comercio: 920001,
    capital: 9600,
    tasa: 24,
    plazo: 12,
    desembolso: '2026-07-18T11:30:00Z',
    primerVence: '2026-08-18',
    cuotasPagadas: 2,
    atraso: 0,
    estado: 'active',
    destino: 'CAPITAL_TRABAJO',
    nota: 'Segundo crédito, mayor monto: el historial limpio del primero lo habilitó.',
  },
  {
    id: 950303,
    cliente: 910002,
    producto: 950002,
    comercio: 920002,
    capital: 3600,
    tasa: 22,
    plazo: 6,
    desembolso: '2026-06-05T10:00:00Z',
    primerVence: '2026-07-05',
    cuotasPagadas: 3,
    atraso: 0,
    estado: 'active',
    destino: 'MEJORA_VIVIENDA',
    nota: 'Materiales para techar. Paga el mismo día que cobra.',
  },
  {
    id: 950304,
    cliente: 910003,
    producto: 950003,
    comercio: 920004,
    capital: 7200,
    tasa: 24,
    plazo: 12,
    desembolso: '2026-03-25T16:45:00Z',
    primerVence: '2026-04-25',
    cuotasPagadas: 5,
    atraso: 0,
    estado: 'active',
    destino: 'EDUCACION',
    nota: 'Computadora para la hija. Cuota calzada al día 25, que es cuando cobra el magisterio.',
  },
  {
    id: 950305,
    cliente: 910004,
    producto: 950001,
    comercio: 920003,
    capital: 900,
    tasa: 18,
    plazo: 3,
    desembolso: '2026-08-20T09:15:00Z',
    primerVence: '2026-09-20',
    cuotasPagadas: 0,
    atraso: 0,
    estado: 'active',
    destino: 'CAPITAL_TRABAJO',
    nota: 'Monto menor al pedido: la capacidad no daba para más, y se le explicó así.',
  },
  {
    id: 950306,
    cliente: 910005,
    producto: 950003,
    comercio: 920001,
    capital: 12000,
    tasa: 24,
    plazo: 12,
    desembolso: '2026-03-12T13:20:00Z',
    primerVence: '2026-04-12',
    cuotasPagadas: 6,
    atraso: 0,
    estado: 'active',
    destino: 'ELECTRODOMESTICO_HOGAR',
    nota: 'Cocina y lavadora. Va por la mitad exacta del plan.',
  },
  {
    id: 950307,
    cliente: 910008,
    producto: 950002,
    comercio: 920002,
    capital: 5400,
    tasa: 22,
    plazo: 6,
    desembolso: '2026-05-02T14:10:00Z',
    primerVence: '2026-06-02',
    cuotasPagadas: 4,
    atraso: 12,
    estado: 'active',
    destino: 'MEJORA_VIVIENDA',
    nota: 'Dos atrasos de más de una semana ya regularizados; la quinta cuota lleva 12 días vencida.',
  },
  {
    id: 950308,
    cliente: 910009,
    producto: 950002,
    comercio: 920004,
    capital: 6000,
    tasa: 22,
    plazo: 6,
    desembolso: '2026-02-14T12:00:00Z',
    primerVence: '2026-03-14',
    cuotasPagadas: 3,
    atraso: 47,
    estado: 'active',
    destino: 'TELEFONO',
    nota: 'Mora de 47 días sin contacto exitoso. Línea suspendida y expediente en cobranza.',
  },
  {
    id: 950309,
    cliente: 910006,
    producto: 950001,
    comercio: 920003,
    capital: 1200,
    tasa: 18,
    plazo: 2,
    desembolso: '2026-09-01T17:30:00Z',
    primerVence: '2026-10-01',
    cuotasPagadas: 0,
    atraso: 0,
    estado: 'active',
    destino: 'CAPITAL_TRABAJO',
    nota: 'Sin boleta ni extracto: su línea se construyó con el historial de compras dentro de la red.',
  },
  {
    id: 950310,
    cliente: 910012,
    producto: 950003,
    comercio: 920004,
    capital: 8400,
    tasa: 24,
    plazo: 12,
    desembolso: '2026-08-30T20:05:00Z',
    primerVence: '2026-09-30',
    cuotasPagadas: 0,
    atraso: 0,
    estado: 'cancelled',
    destino: 'TELEFONO',
    nota: 'Anulado al confirmarse la suplantación: el crédito lo tomó otra persona con el carnet del titular.',
  },
];

/** Cuota francesa: el pago mensual que amortiza capital e interés en partes iguales. */
function cuotaFija(capital: number, tasaAnual: number, plazo: number): number {
  const i = tasaAnual / 100 / 12;
  if (i === 0) return capital / plazo;
  return (capital * i) / (1 - Math.pow(1 + i, -plazo));
}

function sumaDeMeses(fecha: string, meses: number): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const total = mes - 1 + meses;
  const nuevoAnio = anio + Math.floor(total / 12);
  const nuevoMes = (total % 12) + 1;
  const ultimoDia = new Date(Date.UTC(nuevoAnio, nuevoMes, 0)).getUTCDate();
  return `${nuevoAnio}-${String(nuevoMes).padStart(2, '0')}-${String(Math.min(dia, ultimoDia)).padStart(2, '0')}`;
}

const redondear = (valor: number): number => Math.round(valor * 100) / 100;

const cuotas: FilaSembrada[] = [];
const pagos: FilaSembrada[] = [];
const imputaciones: FilaSembrada[] = [];
const eventos: FilaSembrada[] = [];
const prestamos: FilaSembrada[] = [];

let idCuota = 950400;
let idPago = 951000;
let idImputacion = 951150;
let idEvento = 951300;

for (const p of PRESTAMOS) {
  const cuota = cuotaFija(p.capital, p.tasa, p.plazo);
  let saldo = p.capital;
  let interesProgramado = 0;
  let capitalPagado = 0;
  let interesPagado = 0;
  const idsCuota: number[] = [];

  for (let n = 1; n <= p.plazo; n += 1) {
    const interes = redondear((saldo * (p.tasa / 100)) / 12);
    const capital = redondear(n === p.plazo ? saldo : cuota - interes);
    saldo = redondear(saldo - capital);
    interesProgramado = redondear(interesProgramado + interes);

    const pagada = n <= p.cuotasPagadas;
    const vencida = !pagada && n === p.cuotasPagadas + 1 && p.atraso > 0;
    const idEsta = idCuota++;
    idsCuota.push(idEsta);
    if (pagada) {
      capitalPagado = redondear(capitalPagado + capital);
      interesPagado = redondear(interesPagado + interes);
    }
    const recargo = vencida ? redondear(cuota * 0.02) : 0;

    cuotas.push({
      _id: idEsta,
      _tenant_id: T,
      loan_id: p.id,
      installment_number: n,
      due_date: sumaDeMeses(p.primerVence, n - 1),
      principal_amount: capital,
      interest_amount: interes,
      late_fee_amount: recargo,
      paid_principal: pagada ? capital : 0,
      paid_interest: pagada ? interes : 0,
      paid_late_fee: 0,
      status: p.estado === 'cancelled' ? 'pending' : pagada ? 'paid' : vencida ? 'overdue' : 'pending',
      days_past_due: vencida ? p.atraso : 0,
      settled_at: pagada ? `${sumaDeMeses(p.primerVence, n - 1)}T12:00:00Z` : null,
      _created_at: p.desembolso,
      _updated_at: p.desembolso,
      _deleted: false,
    });
  }

  for (let n = 1; n <= p.cuotasPagadas; n += 1) {
    const laCuota = cuotas[cuotas.length - p.plazo + n - 1] as Record<string, number>;
    const monto = redondear(Number(laCuota.principal_amount) + Number(laCuota.interest_amount));
    const idEstePago = idPago++;
    pagos.push({
      _id: idEstePago,
      _tenant_id: T,
      loan_id: p.id,
      payment_code: `PG-${p.id}-${String(n).padStart(2, '0')}`,
      amount: monto,
      currency_code: 'BOB',
      payment_method: n % 3 === 0 ? 'cash_partner' : n % 3 === 1 ? 'qr_transfer' : 'bank_transfer',
      external_reference: `REF-${p.id}${String(n).padStart(2, '0')}`,
      received_at: `${sumaDeMeses(p.primerVence, n - 1)}T12:00:00Z`,
      status: 'applied',
      _created_at: p.desembolso,
      _updated_at: p.desembolso,
      _deleted: false,
    });
    imputaciones.push({
      _id: idImputacion++,
      _tenant_id: T,
      loan_payment_id: idEstePago,
      loan_installment_id: idsCuota[n - 1],
      principal_applied: Number(laCuota.principal_amount),
      interest_applied: Number(laCuota.interest_amount),
      late_fee_applied: 0,
      reversed: false,
      _created_at: p.desembolso,
    });
  }

  const pendiente = redondear(p.capital - capitalPagado);
  prestamos.push({
    _id: p.id,
    _tenant_id: T,
    loan_code: `PR-${p.id}`,
    customer_id: p.cliente,
    credit_application_id: p.id - 950100,
    credit_product_id: p.producto,
    partner_profile_id: p.comercio,
    currency_code: 'BOB',
    principal_amount: p.capital,
    annual_interest_rate: p.tasa,
    term_months: p.plazo,
    status: p.estado,
    disbursed_at: p.estado === 'cancelled' ? null : p.desembolso,
    first_due_date: p.primerVence,
    maturity_date: sumaDeMeses(p.primerVence, p.plazo - 1),
    scheduled_principal: p.capital,
    scheduled_interest: interesProgramado,
    paid_principal: capitalPagado,
    paid_interest: interesPagado,
    paid_late_fee: 0,
    outstanding_principal: p.estado === 'paid_off' ? 0 : pendiente,
    days_past_due: p.atraso,
    worst_days_past_due: p.id === 950307 ? 14 : p.atraso,
    delinquency_bucket: p.atraso === 0 ? 'current' : p.atraso < 30 ? 'dpd_1_29' : p.atraso < 60 ? 'dpd_30_59' : 'dpd_60_89',
    delinquency_evaluated_at: '2026-09-17T06:00:00Z',
    closed_at: p.estado === 'paid_off' ? sumaDeMeses(p.primerVence, p.plazo - 1) + 'T12:00:00Z' : null,
    decision_subject_reference: `customer:${p.cliente}`,
    _created_at: p.desembolso,
    _updated_at: p.desembolso,
    _deleted: false,
  });

  eventos.push(
    {
      _id: idEvento++,
      _tenant_id: T,
      loan_id: p.id,
      event_type: 'disbursed',
      previous_status: 'pending_disbursement',
      new_status: 'active',
      actor_type: 'system',
      happened_at: p.desembolso,
      notes: p.nota,
      _created_at: p.desembolso,
    },
    ...(p.atraso > 0
      ? [
          {
            _id: idEvento++,
            _tenant_id: T,
            loan_id: p.id,
            event_type: 'delinquency_bucket_changed',
            previous_status: 'active',
            new_status: 'active',
            actor_type: 'system',
            reason_code: 'CUOTA_VENCIDA',
            happened_at: '2026-09-17T06:00:00Z',
            notes: `La cuota ${p.cuotasPagadas + 1} lleva ${p.atraso} días vencida.`,
            _created_at: '2026-09-17T06:00:00Z',
          },
        ]
      : []),
    ...(p.estado === 'paid_off'
      ? [
          {
            _id: idEvento++,
            _tenant_id: T,
            loan_id: p.id,
            event_type: 'closed',
            previous_status: 'active',
            new_status: 'paid_off',
            actor_type: 'system',
            happened_at: sumaDeMeses(p.primerVence, p.plazo - 1) + 'T12:00:00Z',
            notes: 'Operación pagada en su totalidad.',
            _created_at: p.desembolso,
          },
        ]
      : []),
    ...(p.estado === 'cancelled'
      ? [
          {
            _id: idEvento++,
            _tenant_id: T,
            loan_id: p.id,
            event_type: 'cancelled',
            previous_status: 'pending_disbursement',
            new_status: 'cancelled',
            actor_type: 'internal_user',
            reason_code: 'FRAUDE_CONFIRMADO',
            happened_at: '2026-09-17T01:00:00Z',
            notes: 'Anulado sin desembolsar: el solicitante no era el titular del documento.',
            _created_at: '2026-09-17T01:00:00Z',
          },
        ]
      : []),
  );
}

const solicitudes = PRESTAMOS.map((p) => ({
  _id: p.id - 950100,
  _tenant_id: T,
  application_code: `SOL-${p.id - 950100}`,
  customer_id: p.cliente,
  credit_product_id: p.producto,
  partner_profile_id: p.comercio,
  requested_amount: p.id === 950305 ? 2000 : p.capital,
  requested_term_months: p.plazo,
  currency_code: 'BOB',
  purpose_code: p.destino,
  status: p.estado === 'cancelled' ? 'cancelled' : 'approved',
  decision_mode: 'decision_engine',
  decision_score: 600 + (p.id % 180),
  decision_risk_band: p.atraso > 30 ? 'C' : p.atraso > 0 ? 'B' : 'A',
  decision_reason_code: p.id === 950305 ? 'MONTO_AJUSTADO_POR_CAPACIDAD' : 'APROBADO',
  decision_reasons_json:
    p.id === 950305
      ? [{ code: 'MONTO_AJUSTADO_POR_CAPACIDAD', detalle: 'Pidió 2.000 y la capacidad sostiene 900.' }]
      : [{ code: 'APROBADO', detalle: 'Capacidad suficiente y sin mora vigente.' }],
  decision_artifact_version_id: 'credit-scoring@2026.3',
  decision_subject_reference: `customer:${p.cliente}`,
  business_acceptance: 'accepted',
  business_acceptance_at: p.desembolso,
  decided_at: p.desembolso,
  submitted_at: p.desembolso,
  _created_at: p.desembolso,
  _updated_at: p.desembolso,
  _deleted: false,
}));

const CLIENTES_CON_LINEA = [910001, 910002, 910003, 910004, 910005, 910006, 910008, 910009];

const lineas = CLIENTES_CON_LINEA.map((cliente, indice) => {
  const suspendida = cliente === 910009;
  const observada = cliente === 910008;
  return {
    _id: 950100 + indice,
    _tenant_id: T,
    customer_id: cliente,
    currency_code: 'BOB',
    approved_limit: suspendida ? 0 : [12000, 8000, 15000, 3000, 14000, 2500, 5000][indice % 7],
    max_affordable_installment: suspendida ? 0 : 420 + indice * 55,
    disposable_income: 900 + indice * 130,
    scoring: 640 + indice * 17,
    credit_risk_score: 640 + indice * 17,
    risk_band: suspendida ? 'D' : observada ? 'C' : indice % 3 === 0 ? 'A' : 'B',
    pricing_tier: suspendida ? 'ninguno' : indice % 3 === 0 ? 'preferen' : 'estandar',
    annual_percentage_rate: suspendida ? 0 : 22,
    affordability_decision: suspendida ? 'not_affordable' : 'affordable',
    probability_of_default: suspendida ? 0.41 : observada ? 0.12 : 0.04,
    decision_outcome: suspendida ? 'SUSPENDED' : 'APPROVED',
    artifact_code: 'credit-limit',
    artifact_version_id: 'credit-limit@2026.2',
    reason_codes_json: suspendida ? ['MORA_VIGENTE'] : observada ? ['ATRASO_REITERADO'] : ['CAPACIDAD_SUFICIENTE'],
    calculation_trigger: suspendida ? 'delinquency' : 'onboarding',
    valid_from: '2026-09-01T00:00:00Z',
    _created_at: '2026-09-01T00:00:00Z',
    _updated_at: '2026-09-01T00:00:00Z',
    _deleted: false,
  };
});

/**
 * La observación de desenlace: lo que Atlas le devuelve al Motor cuando una operación cierra.
 *
 * Sin esto el Motor nunca sabe si acertó, y las cosechas de la pantalla de monitoreo se calculan
 * sobre nada. Se siembran tres: dos entregadas y una agotada tras agotar los seis reintentos, que es lo que la
 * bandeja de «observaciones sin entregar» existe para mostrar — una bandeja siempre vacía no
 * prueba que funcione.
 */
const DESENLACES = [
  {
    _id: 951500,
    loan: 950301,
    label: 'GOOD',
    ventana: 180,
    monto: 4800,
    estado: 'sent',
    intentos: 1,
    error: null,
    notas: 'Operación pagada completa y sin atrasos dentro de la ventana de observación.',
  },
  {
    _id: 951501,
    loan: 950308,
    label: 'BAD',
    ventana: 90,
    monto: 6000,
    estado: 'sent',
    intentos: 2,
    error: null,
    notas: 'Mora superior a 45 días dentro de la ventana. Se informa como desenlace malo aunque la operación siga viva.',
  },
  {
    _id: 951502,
    loan: 950307,
    label: 'INDETERMINATE',
    ventana: 90,
    monto: 5400,
    estado: 'failed',
    intentos: 6,
    error: 'El Motor respondió 503 en los seis intentos; el último a las 06:12.',
    notas: 'Atrasos regularizados: ni bueno ni malo todavía. Sigue sin entregarse y por eso aparece en la bandeja.',
  },
];

const desenlaces = DESENLACES.map((d) => ({
  _id: d._id,
  _tenant_id: T,
  loan_id: d.loan,
  decision_execution_id: `exec-demo-${d.loan}`,
  window_days: d.ventana,
  label: d.label,
  amount: d.monto,
  source: 'core-cartera',
  notes: d.notas,
  status: d.estado,
  attempts: d.intentos,
  last_error: d.error,
  observed_at: '2026-09-17T06:00:00Z',
  sent_at: d.estado === 'sent' ? '2026-09-17T06:01:00Z' : null,
  _created_at: '2026-09-17T06:00:00Z',
  _updated_at: '2026-09-17T06:01:00Z',
}));

export const CARTERA: DominioSembrado = {
  nombre: 'cartera',
  descripcion:
    'Cuatro productos, tres políticas de mora, ocho líneas, diez solicitudes y diez préstamos con su plan de cuotas y sus pagos calculados.',
  bloques: [
    {
      tabla: 'credit.credit_products',
      filas: PRODUCTOS.map((p) => ({
        ...p,
        _tenant_id: T,
        effective_from: '2026-01-01T00:00:00Z',
        _created_at: '2026-01-01T00:00:00Z',
        _updated_at: '2026-01-01T00:00:00Z',
        _deleted: false,
      })),
    },
    {
      tabla: 'credit.delinquency_policies',
      filas: POLITICAS_MORA.map((p) => ({
        ...p,
        _tenant_id: T,
        _created_at: '2026-01-01T00:00:00Z',
        _updated_at: '2026-01-01T00:00:00Z',
        _deleted: false,
      })),
    },
    { tabla: 'credit.credit_lines', filas: lineas },
    { tabla: 'credit.credit_applications', filas: solicitudes },
    { tabla: 'credit.loans', filas: prestamos },
    { tabla: 'credit.loan_installments', filas: cuotas },
    { tabla: 'credit.loan_payments', filas: pagos },
    { tabla: 'credit.loan_payment_allocations', filas: imputaciones },
    { tabla: 'credit.loan_events', filas: eventos },
    { tabla: 'credit.loan_outcome_reports', filas: desenlaces },
  ],
};
