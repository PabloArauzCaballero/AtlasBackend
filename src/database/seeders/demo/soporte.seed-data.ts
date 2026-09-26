/**
 * @file La mesa de soporte: colas, acuerdos de nivel, categorías, agentes, casos y conocimiento.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define seeders para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { sha256Hex } from '../../../common/utils/crypto/hash.util.js';
import { ID_INTERNOS } from './equipo.seed-data.js';
import { refA, TENANT_DEMO, type DominioSembrado, type FilaSembrada } from './tipos.js';

/**
 * Colas, acuerdos y categorías se reconcilian por su CÓDIGO, no por identificador.
 *
 * En desarrollo esas filas ya existen con identificadores bajos que traía la siembra anterior; en
 * pruebas no existe ninguna. Escribir por código deja las dos bases con el mismo catálogo sin
 * duplicar nada y sin mover una clave primaria por debajo de los casos que ya la citan. Todo lo que
 * apunta a una cola la busca con `refA`, así que el número lo pone la base, no este archivo.
 *
 * Bloque: 940001–940099 agentes · 940100–940199 casos · 940200–940299 canales ·
 * 940300–940999 mensajes y eventos · 941000–941099 respuestas guardadas · 941100–941299 conocimiento.
 */
const T = TENANT_DEMO;

const COLAS = [
  {
    queue_code: 'consumer_l1',
    name: 'Consumidores · nivel 1',
    context_type: 'CONSUMER',
    default_priority: 'P3',
    display_order: 10,
    description:
      'Primera línea de personas: acceso, pagos, cuotas y dudas del crédito. Resuelve lo que no exige mirar la decisión por dentro.',
  },
  {
    queue_code: 'consumer_l2',
    name: 'Consumidores · nivel 2',
    context_type: 'CONSUMER',
    default_priority: 'P2',
    display_order: 20,
    description: 'Lo que el nivel 1 no puede cerrar: revisión de cuotas, ajustes de cartera y explicaciones que exigen leer el expediente.',
  },
  {
    queue_code: 'credit_specialist',
    name: 'Especialistas de crédito',
    context_type: 'CONSUMER',
    default_priority: 'P2',
    display_order: 30,
    description:
      'Preguntas sobre por qué salió una decisión y sobre el límite asignado. Las contesta quien puede leer el artefacto que decidió.',
  },
  {
    queue_code: 'security_fraud',
    name: 'Seguridad y fraude',
    context_type: 'CONSUMER',
    default_priority: 'P1',
    display_order: 40,
    description: 'Suplantación, cuentas tomadas y compras desconocidas. Entra con prioridad máxima y bloquea antes de preguntar.',
  },
  {
    queue_code: 'privacy',
    name: 'Privacidad',
    context_type: 'CONSUMER',
    default_priority: 'P2',
    display_order: 50,
    description:
      'Solicitudes sobre datos personales: acceso, rectificación y supresión. Tiene plazo legal propio, distinto del acuerdo comercial.',
  },
  {
    queue_code: 'complaints',
    name: 'Reclamos',
    context_type: 'CONSUMER',
    default_priority: 'P2',
    display_order: 60,
    description: 'Reclamos formales. Se registran aunque la razón no asista al cliente: el registro es la evidencia ante el regulador.',
  },
  {
    queue_code: 'partner_l1',
    name: 'Comercios · nivel 1',
    context_type: 'PARTNER_USER',
    default_priority: 'P3',
    display_order: 70,
    description: 'Dudas del comercio sobre operar: cobros, terminales y accesos de su equipo.',
  },
  {
    queue_code: 'partner_operations',
    name: 'Comercios · operaciones',
    context_type: 'PARTNER_USER',
    default_priority: 'P2',
    display_order: 80,
    description: 'Conciliación, comisiones y facturación del comercio. Toca dinero, así que siempre deja rastro contable.',
  },
];

const ACUERDOS = [
  {
    policy_code: 'sla_p1',
    priority: 'P1',
    acknowledge_target_minutes: 5,
    first_response_target_minutes: 15,
    update_interval_minutes: 30,
    resolution_target_minutes: 240,
    calendar_kind: '24x7',
    change_reason: 'Fraude y accesos comprometidos no esperan al horario de oficina: el daño crece cada hora.',
  },
  {
    policy_code: 'sla_p2',
    priority: 'P2',
    acknowledge_target_minutes: 15,
    first_response_target_minutes: 60,
    update_interval_minutes: 240,
    resolution_target_minutes: 1440,
    calendar_kind: 'business_hours',
    change_reason: 'Dinero y decisiones de crédito: un día hábil para cerrar, con avance cada cuatro horas.',
  },
  {
    policy_code: 'sla_p3',
    priority: 'P3',
    acknowledge_target_minutes: 60,
    first_response_target_minutes: 240,
    update_interval_minutes: 480,
    resolution_target_minutes: 2880,
    calendar_kind: 'business_hours',
    change_reason: 'El grueso de la mesa. Dos días hábiles, que es lo que el equipo sostiene sin acumular cola.',
  },
  {
    policy_code: 'sla_p4',
    priority: 'P4',
    acknowledge_target_minutes: 240,
    first_response_target_minutes: 960,
    update_interval_minutes: 1440,
    resolution_target_minutes: 7200,
    calendar_kind: 'business_hours',
    change_reason: 'Consultas sin impacto operativo. Se contestan, pero no desplazan a nadie.',
  },
];

interface CategoriaSemilla {
  readonly code: string;
  readonly domain: string;
  readonly label: string;
  readonly audience: string;
  readonly tipo: string;
  readonly cola: string;
  readonly descripcion: string;
  readonly sensibilidad?: string;
  readonly especialista?: boolean;
}

const CATEGORIAS: CategoriaSemilla[] = [
  {
    code: 'ACCOUNT_ACCESS',
    domain: 'AUTH',
    label: 'No puedo entrar a mi cuenta',
    audience: 'CONSUMER',
    tipo: 'ACCOUNT_ACCESS',
    cola: 'consumer_l1',
    descripcion: 'La persona no logra iniciar sesión. Antes de tocar nada se comprueba que sea ella.',
  },
  {
    code: 'AUTH_OTP_NOT_RECEIVED',
    domain: 'AUTH',
    label: 'No me llega el código',
    audience: 'CONSUMER',
    tipo: 'ACCOUNT_ACCESS',
    cola: 'consumer_l1',
    descripcion: 'El código de un solo uso no llega. Casi siempre es la operadora o un número mal escrito, no el sistema.',
  },
  {
    code: 'AUTH_ACCOUNT_LOCKED',
    domain: 'AUTH',
    label: 'Mi cuenta está bloqueada',
    audience: 'CONSUMER',
    tipo: 'ACCOUNT_ACCESS',
    cola: 'consumer_l1',
    descripcion: 'Bloqueo por intentos fallidos o por una señal de seguridad. Desbloquear exige verificar identidad.',
  },
  {
    code: 'PAYMENTS',
    domain: 'PAYMENT',
    label: 'Pagos y cuotas',
    audience: 'CONSUMER',
    tipo: 'PAYMENT_EVIDENCE',
    cola: 'consumer_l1',
    descripcion: 'Dudas generales sobre cómo y cuándo pagar.',
  },
  {
    code: 'PAY_EVIDENCE_NOT_APPLIED',
    domain: 'PAYMENT',
    label: 'Pagué y no se refleja',
    audience: 'CONSUMER',
    tipo: 'PAYMENT_EVIDENCE',
    cola: 'consumer_l2',
    descripcion: 'El comprobante existe y la cuota sigue abierta. Se compara contra el extracto del comercio antes de acreditar.',
  },
  {
    code: 'PAY_INSTALLMENT_MISMATCH',
    domain: 'INSTALLMENTS',
    label: 'La cuota no cuadra',
    audience: 'CONSUMER',
    tipo: 'SERVICE_REQUEST',
    cola: 'consumer_l2',
    descripcion: 'El monto cobrado no coincide con el plan. Se revisa la imputación de pagos antes de responder.',
  },
  {
    code: 'CREDIT',
    domain: 'CREDIT',
    label: 'Mi crédito',
    audience: 'CONSUMER',
    tipo: 'CREDIT_DECISION_EXPLANATION',
    cola: 'consumer_l1',
    descripcion: 'Preguntas generales sobre el crédito vigente.',
  },
  {
    code: 'CREDIT_DECISION_EXPLANATION',
    domain: 'CREDIT',
    label: 'Por qué me dieron esta respuesta',
    audience: 'CONSUMER',
    tipo: 'CREDIT_DECISION_EXPLANATION',
    cola: 'credit_specialist',
    descripcion:
      'Explicación de una decisión de crédito. Se responde con los motivos comunicables del catálogo, nunca con la lógica del modelo.',
    especialista: true,
  },
  {
    code: 'CREDIT_LIMIT_QUESTION',
    domain: 'CREDIT',
    label: 'Mi límite de crédito',
    audience: 'CONSUMER',
    tipo: 'QUESTION',
    cola: 'credit_specialist',
    descripcion: 'Por qué el límite es el que es y qué lo cambia.',
    especialista: true,
  },
  {
    code: 'KYC',
    domain: 'KYC',
    label: 'Verificación de identidad',
    audience: 'CONSUMER',
    tipo: 'IDENTITY_KYC',
    cola: 'consumer_l1',
    descripcion: 'Dudas del paso de identidad durante el alta.',
    sensibilidad: 'SENSITIVE',
  },
  {
    code: 'KYC_DOCUMENT_REJECTED',
    domain: 'KYC',
    label: 'Rechazaron mi documento',
    audience: 'CONSUMER',
    tipo: 'IDENTITY_KYC',
    cola: 'consumer_l2',
    descripcion: 'El documento no pasó las comprobaciones. Se revisa la captura antes de pedir una nueva.',
    sensibilidad: 'SENSITIVE',
  },
  {
    code: 'PURCHASE_QR',
    domain: 'QR',
    label: 'Comprar con QR',
    audience: 'CONSUMER',
    tipo: 'QR_SUPPORT',
    cola: 'consumer_l1',
    descripcion: 'El QR no escanea, no carga o el comercio no lo reconoce.',
  },
  {
    code: 'FRAUD_REPORT',
    domain: 'SECURITY',
    label: 'Reportar un fraude',
    audience: 'CONSUMER',
    tipo: 'FRAUD_REPORT',
    cola: 'security_fraud',
    descripcion: 'Compras que la persona no hizo o suplantación. Se bloquea primero y se investiga después.',
    sensibilidad: 'RESTRICTED',
    especialista: true,
  },
  {
    code: 'PRIVACY_REQUEST',
    domain: 'PRIVACY',
    label: 'Mis datos personales',
    audience: 'CONSUMER',
    tipo: 'PRIVACY_REQUEST',
    cola: 'privacy',
    descripcion: 'Acceso, rectificación o supresión de datos. Corre un plazo legal propio desde que entra.',
    sensibilidad: 'SENSITIVE',
  },
  {
    code: 'COMPLAINT',
    domain: 'OTHER',
    label: 'Presentar un reclamo',
    audience: 'CONSUMER',
    tipo: 'COMPLAINT',
    cola: 'complaints',
    descripcion: 'Reclamo formal. Se registra siempre, tenga razón o no, porque el registro es la evidencia.',
  },
  {
    code: 'BUG_REPORT',
    domain: 'PLATFORM',
    label: 'Algo no funciona',
    audience: 'ANY',
    tipo: 'BUG_REPORT',
    cola: 'consumer_l1',
    descripcion: 'Fallo de la aplicación o del portal. Se pide versión, pantalla y hora para poder reproducirlo.',
  },
  {
    code: 'OTHER',
    domain: 'OTHER',
    label: 'Otro motivo',
    audience: 'ANY',
    tipo: 'OTHER',
    cola: 'consumer_l1',
    descripcion: 'Lo que no encaja en ninguna categoría. Si se repite, se convierte en categoría propia.',
  },
  {
    code: 'PARTNER_ONBOARDING',
    domain: 'PARTNER',
    label: 'Alta y activación del comercio',
    audience: 'PARTNER_USER',
    tipo: 'PARTNER_ONBOARDING',
    cola: 'partner_l1',
    descripcion: 'El comercio pregunta por su solicitud de alta o por qué sigue sin poder cobrar.',
  },
  {
    code: 'PARTNER_OPERATION',
    domain: 'PARTNER',
    label: 'Operar el comercio',
    audience: 'PARTNER_USER',
    tipo: 'PARTNER_OPERATION',
    cola: 'partner_l1',
    descripcion: 'Día a día del comercio: usuarios de su equipo, sucursales y permisos.',
  },
  {
    code: 'PARTNER_QR_TERMINAL',
    domain: 'QR',
    label: 'QR y terminales de cobro',
    audience: 'PARTNER_USER',
    tipo: 'QR_SUPPORT',
    cola: 'partner_l1',
    descripcion: 'El QR de cobro o la terminal no funcionan como deberían.',
  },
  {
    code: 'PARTNER_RECONCILIATION',
    domain: 'REPORTING',
    label: 'Conciliación de cobros',
    audience: 'PARTNER_USER',
    tipo: 'RECONCILIATION_SUPPORT',
    cola: 'partner_operations',
    descripcion: 'Diferencias entre lo que el comercio vendió y lo que se le liquidó.',
  },
  {
    code: 'PARTNER_BILLING',
    domain: 'REPORTING',
    label: 'Facturación y comisiones',
    audience: 'PARTNER_USER',
    tipo: 'BILLING_MDR_SUPPORT',
    cola: 'partner_operations',
    descripcion: 'La comisión cobrada y la factura del período.',
  },
];

const AGENTES = [
  { id: 940001, usuario: ID_INTERNOS.soporteL1, nivel: 'L1', cola: 'consumer_l1', presencia: 'AVAILABLE', canales: 4 },
  { id: 940002, usuario: ID_INTERNOS.soporteL2, nivel: 'L2', cola: 'consumer_l2', presencia: 'BUSY', canales: 3 },
  { id: 940003, usuario: ID_INTERNOS.riesgo, nivel: 'SPECIALIST', cola: 'credit_specialist', presencia: 'AVAILABLE', canales: 2 },
  { id: 940004, usuario: ID_INTERNOS.fraude, nivel: 'SPECIALIST', cola: 'security_fraud', presencia: 'AVAILABLE', canales: 2 },
  { id: 940005, usuario: ID_INTERNOS.cumplimiento, nivel: 'SPECIALIST', cola: 'privacy', presencia: 'AWAY', canales: 2 },
  { id: 940006, usuario: ID_INTERNOS.comercios, nivel: 'SUPERVISOR', cola: 'partner_l1', presencia: 'AVAILABLE', canales: 5 },
];

interface CasoSemilla {
  readonly id: number;
  readonly numero: string;
  readonly contexto: string;
  readonly cliente: number | null;
  readonly comercio: number | null;
  readonly categoria: string;
  readonly cola: string;
  readonly agente: number | null;
  readonly prioridad: string;
  readonly estado: string;
  readonly titulo: string;
  readonly resumen: string;
  readonly interno: string;
  readonly abierto: string;
  readonly conversacion: readonly { readonly quien: 'cliente' | 'agente' | 'nota'; readonly texto: string }[];
  readonly resolucion?: { readonly codigo: string; readonly causa: string; readonly alCliente: string; readonly interna: string };
  readonly csat?: number;
}

const CASOS: CasoSemilla[] = [
  {
    id: 940101,
    numero: 'CS-2026-0001',
    contexto: 'CONSUMER',
    cliente: 910001,
    comercio: null,
    categoria: 'PAY_EVIDENCE_NOT_APPLIED',
    cola: 'consumer_l2',
    agente: 940002,
    prioridad: 'P2',
    estado: 'RESOLVED',
    abierto: '2026-09-12T14:05:00Z',
    titulo: 'Pagué la cuota el lunes y sigue apareciendo pendiente',
    resumen: 'La clienta pagó por transferencia y el comprobante no se acreditó automáticamente.',
    interno:
      'La transferencia entró con el nombre del esposo como ordenante; el conciliador no la enlazó. Se acreditó a mano y se dejó nota en la cuenta.',
    conversacion: [
      {
        quien: 'cliente',
        texto: 'Buenas tardes, pagué mi cuota el lunes por el banco y en la app todavía me sale pendiente. Les mando el comprobante.',
      },
      { quien: 'agente', texto: 'Gracias María Elena, ya lo veo. Voy a cruzarlo con el extracto del día; te confirmo hoy mismo.' },
      { quien: 'nota', texto: 'El ordenante de la transferencia es otra persona (esposo). Por eso la conciliación automática no la tomó.' },
      {
        quien: 'agente',
        texto:
          'Listo: la cuota ya figura pagada. El pago venía a nombre de otra persona y por eso no se enlazó solo. Si vuelve a pasar, avisanos y lo hacemos el mismo día.',
      },
    ],
    resolucion: {
      codigo: 'PAYMENT_EVIDENCE_ACCEPTED',
      causa: 'PROCESS_FAILURE',
      alCliente: 'Confirmamos tu pago y la cuota quedó al día. El comprobante venía a nombre de otra persona, por eso no se acreditó solo.',
      interna: 'Acreditación manual. Queda pendiente evaluar si el conciliador debe aceptar ordenante distinto con cédula coincidente.',
    },
    csat: 5,
  },
  {
    id: 940102,
    numero: 'CS-2026-0002',
    contexto: 'CONSUMER',
    cliente: 910007,
    comercio: null,
    categoria: 'KYC_DOCUMENT_REJECTED',
    cola: 'consumer_l2',
    agente: 940002,
    prioridad: 'P2',
    estado: 'WAITING_CUSTOMER',
    abierto: '2026-09-15T09:40:00Z',
    titulo: 'Me rechazaron el carnet tres veces',
    resumen: 'La verificación de identidad no supera el umbral por calidad de la foto.',
    interno: 'Las tres capturas salieron con reflejo sobre el holograma. No hay señal de fraude: es luz. Se le pidió repetir bajo sombra.',
    conversacion: [
      { quien: 'cliente', texto: 'Ya intenté tres veces con mi carnet y siempre me dice que no se pudo verificar. ¿Qué hago?' },
      {
        quien: 'agente',
        texto:
          'Miré tus tres intentos: el problema es el reflejo de la luz sobre el holograma, no tu documento. Probá bajo sombra, sin flash, y apoyando el carnet en una superficie mate.',
      },
      { quien: 'nota', texto: 'Confianza del OCR 0,61 en las tres. Sin discrepancia de nombre ni de rostro: es calidad de imagen.' },
    ],
  },
  {
    id: 940103,
    numero: 'CS-2026-0003',
    contexto: 'CONSUMER',
    cliente: 910012,
    comercio: null,
    categoria: 'FRAUD_REPORT',
    cola: 'security_fraud',
    agente: 940004,
    prioridad: 'P1',
    estado: 'ESCALATED',
    abierto: '2026-09-16T23:12:00Z',
    titulo: 'Hay compras que yo no hice',
    resumen: 'La persona denuncia dos compras desconocidas en un comercio de tecnología.',
    interno: 'Coincide con el caso de suplantación abierto: el mismo carnet con dos rostros. La cuenta quedó bloqueada antes de contestar.',
    conversacion: [
      { quien: 'cliente', texto: 'Me llegaron dos avisos de compra de anoche y yo no compré nada. Nunca estuve en ese lugar.' },
      {
        quien: 'agente',
        texto:
          'Bloqueamos tu cuenta ahora mismo para que no pueda usarse. No vas a pagar nada mientras investigamos. Te contacto en menos de 24 horas.',
      },
      {
        quien: 'nota',
        texto:
          'Escalado a fraude. Dispositivo distinto, IP de otra ciudad y el rostro de la última verificación no coincide con el del alta.',
      },
    ],
  },
  {
    id: 940104,
    numero: 'CS-2026-0004',
    contexto: 'CONSUMER',
    cliente: 910010,
    comercio: null,
    categoria: 'CREDIT_DECISION_EXPLANATION',
    cola: 'credit_specialist',
    agente: 940003,
    prioridad: 'P2',
    estado: 'CLOSED',
    abierto: '2026-08-23T10:30:00Z',
    titulo: '¿Por qué me negaron el crédito?',
    resumen: 'Pide la razón de un rechazo por capacidad de pago.',
    interno:
      'Rechazo por capacidad, sin señales de fraude ni mora. Se le explicó con el motivo comunicable y se le ofreció reintentar con monto menor.',
    conversacion: [
      { quien: 'cliente', texto: 'Quiero saber por qué me dijeron que no. Yo trabajo y nunca debí nada.' },
      {
        quien: 'agente',
        texto:
          'No es por antecedentes: no tenés ninguno en contra. Con el ingreso que pudimos verificar, la cuota del monto que pediste quedaba por encima de lo que consideramos pagable. Con un monto menor o un plazo más largo el resultado puede cambiar.',
      },
      { quien: 'cliente', texto: 'Entiendo. ¿Cuándo puedo volver a intentar?' },
      {
        quien: 'agente',
        texto: 'Podés intentar cuando quieras con un monto menor; y si tu ingreso cambia, en 60 días la evaluación se rehace completa.',
      },
    ],
    resolucion: {
      codigo: 'POLICY_EXPLANATION',
      causa: 'POLICY',
      alCliente: 'Te explicamos el motivo del rechazo y las dos maneras de volver a intentarlo.',
      interna: 'Explicación entregada con el motivo comunicable CAPACIDAD_INSUFICIENTE. No se reveló ninguna variable del modelo.',
    },
    csat: 4,
  },
  {
    id: 940105,
    numero: 'CS-2026-0005',
    contexto: 'CONSUMER',
    cliente: 910009,
    comercio: null,
    categoria: 'PAY_INSTALLMENT_MISMATCH',
    cola: 'consumer_l2',
    agente: null,
    prioridad: 'P2',
    estado: 'NEW',
    abierto: '2026-09-17T08:55:00Z',
    titulo: 'Me están cobrando más de lo que dice mi plan',
    resumen: 'Diferencia entre la cuota del plan y el monto que ve la clienta.',
    interno: 'Sin asignar todavía. Es el caso recién entrado que la bandeja debe mostrar arriba.',
    conversacion: [{ quien: 'cliente', texto: 'Mi plan decía 420 bolivianos y me están cobrando 511. ¿Por qué?' }],
  },
  {
    id: 940106,
    numero: 'CS-2026-0006',
    contexto: 'CONSUMER',
    cliente: 910003,
    comercio: null,
    categoria: 'PRIVACY_REQUEST',
    cola: 'privacy',
    agente: 940005,
    prioridad: 'P2',
    estado: 'IN_PROGRESS',
    abierto: '2026-09-13T16:20:00Z',
    titulo: 'Quiero saber qué datos míos tienen',
    resumen: 'Solicitud de acceso a datos personales.',
    interno: 'Plazo legal corriendo desde el 13/09. El paquete se arma con el expediente y se entrega por canal autenticado.',
    conversacion: [
      { quien: 'cliente', texto: 'Quisiera una copia de toda la información que tienen sobre mí.' },
      {
        quien: 'agente',
        texto:
          'Por supuesto. Estamos preparando el paquete; te lo entregamos dentro del plazo y por un canal donde tengas que identificarte, para que no lo reciba nadie más.',
      },
    ],
  },
  {
    id: 940107,
    numero: 'CS-2026-0007',
    contexto: 'PARTNER_USER',
    cliente: null,
    comercio: 920005,
    categoria: 'PARTNER_QR_TERMINAL',
    cola: 'partner_l1',
    agente: 940006,
    prioridad: 'P2',
    estado: 'WAITING_PARTNER',
    abierto: '2026-09-15T12:10:00Z',
    titulo: 'Mi QR de cobro sigue en revisión',
    resumen: 'El comercio no puede cobrar porque su QR no fue aprobado.',
    interno: 'La imagen llega cortada y no se lee la entidad. Se le pidió volver a subirla completa.',
    conversacion: [
      { quien: 'cliente', texto: 'Subimos el QR hace tres días y seguimos sin poder cobrar. ¿Falta algo?' },
      {
        quien: 'agente',
        texto:
          'Sí: la foto llega cortada por abajo y no se alcanza a leer la entidad del QR. Necesitamos la imagen completa, con el código y el nombre del banco visibles.',
      },
    ],
  },
  {
    id: 940108,
    numero: 'CS-2026-0008',
    contexto: 'PARTNER_USER',
    cliente: null,
    comercio: 920001,
    categoria: 'PARTNER_RECONCILIATION',
    cola: 'partner_operations',
    agente: 940006,
    prioridad: 'P2',
    estado: 'RESOLVED',
    abierto: '2026-09-09T09:00:00Z',
    titulo: 'La liquidación del viernes no cuadra con nuestras ventas',
    resumen: 'Diferencia de 1.240 Bs entre lo vendido y lo liquidado.',
    interno: 'Dos ventas se anularon después del corte y se liquidaron al día siguiente. No hubo error de cálculo.',
    conversacion: [
      { quien: 'cliente', texto: 'Nos falta plata en la liquidación del viernes: vendimos 18.400 y nos depositaron 17.160.' },
      {
        quien: 'agente',
        texto:
          'Revisado. Dos ventas se anularon después del corte de las 18:00 y salieron en la liquidación del lunes. La suma de las dos es exactamente la diferencia.',
      },
    ],
    resolucion: {
      codigo: 'ANSWERED',
      causa: 'USER_MISUNDERSTANDING',
      alCliente: 'La diferencia son dos ventas anuladas después del corte; se liquidaron el lunes.',
      interna: 'Sin incidencia. Conviene mostrar el corte en el propio reporte del comercio para evitar el reclamo.',
    },
    csat: 4,
  },
  {
    id: 940109,
    numero: 'CS-2026-0009',
    contexto: 'CONSUMER',
    cliente: 910008,
    comercio: null,
    categoria: 'AUTH_OTP_NOT_RECEIVED',
    cola: 'consumer_l1',
    agente: 940001,
    prioridad: 'P3',
    estado: 'CLOSED',
    abierto: '2026-09-06T18:45:00Z',
    titulo: 'No me llega el código para entrar',
    resumen: 'El código de un solo uso no llegaba al teléfono.',
    interno: 'El número estaba escrito con un dígito de más. Se corrigió tras verificar identidad por el documento.',
    conversacion: [
      { quien: 'cliente', texto: 'No me llega el código por más que le doy a reenviar.' },
      {
        quien: 'agente',
        texto: 'Tu número quedó cargado con un dígito de más. Lo corregimos después de verificar tu identidad y ya te debería llegar.',
      },
      { quien: 'cliente', texto: 'Ya entré, gracias.' },
    ],
    resolucion: {
      codigo: 'CONFIGURATION_FIXED',
      causa: 'DATA_QUALITY',
      alCliente: 'Corregimos tu número y el código ya llega.',
      interna: 'Número con un dígito extra desde el alta. El formulario debería validar largo por país.',
    },
    csat: 5,
  },
  {
    id: 940110,
    numero: 'CS-2026-0010',
    contexto: 'INTERNAL',
    cliente: null,
    comercio: null,
    categoria: 'BUG_REPORT',
    cola: 'consumer_l1',
    agente: 940001,
    prioridad: 'P3',
    estado: 'TRIAGED',
    abierto: '2026-09-17T07:30:00Z',
    titulo: 'La pantalla de cuotas queda en blanco al filtrar por vencidas',
    resumen: 'Reportado por el propio equipo de soporte mientras atendía un caso.',
    interno: 'Reproducido en dos navegadores. Falta adjuntar el error de consola y abrir el ticket técnico.',
    conversacion: [
      { quien: 'cliente', texto: 'Al filtrar cuotas por «vencidas» la tabla queda en blanco, sin mensaje. Con los otros filtros anda.' },
      {
        quien: 'nota',
        texto: 'Reproducido en Chrome y Firefox. Pasa con cero resultados: falta el estado vacío, no es un fallo de datos.',
      },
    ],
  },
];

const colas = COLAS.map((c) => ({
  ...c,
  _tenant_id: T,
  sla_policy_code: c.default_priority === 'P1' ? 'sla_p1' : c.default_priority === 'P2' ? 'sla_p2' : 'sla_p3',
  skills_required_json: [],
  is_active: true,
}));

const acuerdos = ACUERDOS.map((a) => ({
  ...a,
  _tenant_id: T,
  version_number: 1,
  status: 'active',
  timezone: 'America/La_Paz',
  warning_percents_json: [50, 80],
  effective_from: '2026-01-01T00:00:00Z',
}));

const categorias = CATEGORIAS.map((c, indice) => ({
  _tenant_id: T,
  category_code: c.code,
  domain: c.domain,
  default_case_type: c.tipo,
  label: c.label,
  description: c.descripcion,
  audience: c.audience,
  sensitivity: c.sensibilidad ?? 'NORMAL',
  default_queue_id: refA('support.support_queues', { _tenant_id: T, queue_code: c.cola }),
  requires_specialist: c.especialista ?? false,
  catalog_version: 1,
  display_order: (indice + 1) * 10,
  is_active: true,
}));

const agentes = AGENTES.map((a) => ({
  _id: a.id,
  _tenant_id: T,
  internal_user_id: a.usuario,
  support_level: a.nivel,
  default_queue_id: refA('support.support_queues', { _tenant_id: T, queue_code: a.cola }),
  timezone: 'America/La_Paz',
  language_codes_json: ['es'],
  employment_status: 'active',
  max_concurrent_channels: a.canales,
  active_channel_count: 0,
  presence_state: a.presencia,
  is_active: true,
}));

const casos = CASOS.map((c) => ({
  _id: c.id,
  _tenant_id: T,
  case_number: c.numero,
  subject_context_type: c.contexto,
  subject_customer_id: c.cliente,
  subject_partner_profile_id: c.comercio,
  opened_by_actor_type: c.contexto === 'INTERNAL' ? 'internal_user' : c.contexto === 'CONSUMER' ? 'customer' : 'merchant_user',
  opened_by_actor_id: String(c.cliente ?? c.comercio ?? ID_INTERNOS.soporteL1),
  origin_channel: c.contexto === 'INTERNAL' ? 'INTERNAL_PORTAL' : 'HELP_CENTER',
  case_type: CATEGORIAS.find((x) => x.code === c.categoria)?.tipo ?? 'OTHER',
  domain: CATEGORIAS.find((x) => x.code === c.categoria)?.domain ?? 'OTHER',
  category_id: refA('support.support_case_categories', { _tenant_id: T, category_code: c.categoria, catalog_version: 1 }),
  priority: c.prioridad,
  impact: 'INDIVIDUAL',
  urgency: c.prioridad === 'P1' ? 'CRITICAL' : 'NORMAL',
  sensitivity: CATEGORIAS.find((x) => x.code === c.categoria)?.sensibilidad ?? 'NORMAL',
  status: c.estado,
  queue_id: refA('support.support_queues', { _tenant_id: T, queue_code: c.cola }),
  current_assignee_agent_id: c.agente,
  title: c.titulo,
  public_summary: c.resumen,
  internal_summary: c.interno,
  locale: 'es-BO',
  opened_at: c.abierto,
  triaged_at: c.estado === 'NEW' ? null : c.abierto,
  first_response_at: c.estado === 'NEW' ? null : c.abierto,
  resolved_at: ['RESOLVED', 'CLOSED'].includes(c.estado) ? c.abierto : null,
  closed_at: c.estado === 'CLOSED' ? c.abierto : null,
  last_activity_at: c.abierto,
  sla_policy_version_id: refA('support.support_sla_policies', {
    _tenant_id: T,
    policy_code: c.prioridad === 'P1' ? 'sla_p1' : c.prioridad === 'P2' ? 'sla_p2' : 'sla_p3',
    version_number: 1,
  }),
  last_event_sequence: c.conversacion.length + 1,
  _created_at: c.abierto,
  _updated_at: c.abierto,
  _deleted: false,
}));

const canales = CASOS.map((c, indice) => ({
  _id: 940200 + indice,
  _tenant_id: T,
  channel_code: `${c.numero}-CH1`,
  case_id: c.id,
  channel_type: 'ASYNC_MESSAGING',
  subject_context_type: c.contexto,
  subject_customer_id: c.cliente,
  subject_partner_profile_id: c.comercio,
  status: ['RESOLVED', 'CLOSED'].includes(c.estado) ? 'CLOSED' : 'OPEN',
  queue_id: refA('support.support_queues', { _tenant_id: T, queue_code: c.cola }),
  assigned_agent_profile_id: c.agente,
  requested_at: c.abierto,
  opened_at: c.abierto,
  first_response_at: c.estado === 'NEW' ? null : c.abierto,
  last_activity_at: c.abierto,
  closed_at: ['RESOLVED', 'CLOSED'].includes(c.estado) ? c.abierto : null,
  close_reason: ['RESOLVED', 'CLOSED'].includes(c.estado) ? 'AGENT_ENDED' : null,
  last_message_sequence: c.conversacion.length,
  locale: 'es-BO',
  _created_at: c.abierto,
  _updated_at: c.abierto,
  _deleted: false,
}));

const mensajes: FilaSembrada[] = [];
const eventos: FilaSembrada[] = [];
let idMensaje = 940300;
let idEvento = 940600;

for (const [indice, caso] of CASOS.entries()) {
  const canal = 940200 + indice;
  let anterior: string | null = null;
  caso.conversacion.forEach((linea, posicion) => {
    const cuerpo = linea.texto;
    const contenido = sha256Hex(`${caso.numero}:${posicion}:${cuerpo}`);
    const integridad = sha256Hex(`${anterior ?? ''}:${contenido}`);
    mensajes.push({
      _id: idMensaje++,
      _tenant_id: T,
      channel_id: canal,
      server_sequence: posicion + 1,
      client_message_id: `${caso.numero}-m${posicion + 1}`,
      sender_actor_type: linea.quien === 'cliente' ? (caso.contexto === 'CONSUMER' ? 'customer' : 'merchant_user') : 'internal_user',
      sender_actor_id:
        linea.quien === 'cliente' ? String(caso.cliente ?? caso.comercio ?? 0) : String(caso.agente ?? ID_INTERNOS.soporteL1),
      sender_agent_profile_id: linea.quien === 'cliente' ? null : caso.agente,
      message_type: linea.quien === 'nota' ? 'INTERNAL_NOTE' : 'TEXT',
      visibility: linea.quien === 'nota' ? 'INTERNAL' : 'PUBLIC',
      body_text: cuerpo,
      classification: caso.categoria === 'FRAUD_REPORT' ? 'RESTRICTED' : 'NORMAL',
      content_hash: contenido,
      previous_message_hash: anterior,
      integrity_hash: integridad,
      created_at: caso.abierto,
    });
    anterior = integridad;
  });

  let anteriorEvento: string | null = null;
  const pasos = [
    { tipo: 'CASE_OPENED', datos: { origen: caso.contexto } },
    ...(caso.agente ? [{ tipo: 'CASE_ASSIGNED', datos: { agentProfileId: caso.agente } }] : []),
    ...(caso.resolucion ? [{ tipo: 'CASE_RESOLVED', datos: { resolutionCode: caso.resolucion.codigo } }] : []),
  ];
  pasos.forEach((paso, posicion) => {
    const hash = sha256Hex(`${caso.numero}:e${posicion}:${paso.tipo}`);
    eventos.push({
      _id: idEvento++,
      _tenant_id: T,
      case_id: caso.id,
      sequence_number: posicion + 1,
      event_type: paso.tipo,
      actor_type: posicion === 0 && caso.contexto !== 'INTERNAL' ? 'customer' : 'internal_user',
      actor_id: String(caso.agente ?? caso.cliente ?? ID_INTERNOS.soporteL1),
      occurred_at: caso.abierto,
      payload_json: paso.datos,
      previous_hash: anteriorEvento,
      event_hash: hash,
      _created_at: caso.abierto,
    });
    anteriorEvento = hash;
  });
}

const asignaciones = CASOS.filter((c) => c.agente !== null).map((c, indice) => ({
  _id: 940900 + indice,
  _tenant_id: T,
  case_id: c.id,
  assignee_type: 'AGENT',
  assignee_agent_profile_id: c.agente,
  assigned_at: c.abierto,
  assignment_reason: 'auto_routing',
  assignment_version: 1,
  _created_at: c.abierto,
}));

const resoluciones = CASOS.filter((c) => c.resolucion).map((c, indice) => ({
  _id: 940950 + indice,
  _tenant_id: T,
  case_id: c.id,
  resolution_sequence: 1,
  resolution_code: c.resolucion!.codigo,
  root_cause_code: c.resolucion!.causa,
  customer_resolution: c.resolucion!.alCliente,
  internal_resolution: c.resolucion!.interna,
  resolved_by_agent_id: c.agente,
  resolved_at: c.abierto,
  _created_at: c.abierto,
}));

const encuestas = CASOS.filter((c) => c.csat).map((c, indice) => ({
  _id: 940980 + indice,
  _tenant_id: T,
  case_id: c.id,
  respondent_actor_type: c.contexto === 'CONSUMER' ? 'customer' : 'merchant_user',
  respondent_actor_id: String(c.cliente ?? c.comercio ?? 0),
  csat_score: c.csat,
  effort_score: c.csat === 5 ? 2 : 3,
  comment:
    c.csat === 5 ? 'Rápido y me explicaron en palabras que entiendo.' : 'Se resolvió, aunque tuve que esperar más de lo que esperaba.',
  submitted_at: c.abierto,
  _created_at: c.abierto,
}));

const RESPUESTAS = [
  {
    code: 'saludo_inicial',
    titulo: 'Saludo y toma del caso',
    cuerpo: 'Hola {{nombre}}, soy {{agente}} del equipo de Atlas. Ya estoy viendo tu caso y te escribo en cuanto tenga la respuesta.',
    variables: ['nombre', 'agente'],
  },
  {
    code: 'pago_no_acreditado',
    titulo: 'Pago informado y en verificación',
    cuerpo:
      'Recibimos tu comprobante. Lo estamos cruzando con el movimiento del banco; si corresponde, la cuota queda al día hoy mismo y te aviso por acá.',
    variables: [],
  },
  {
    code: 'identidad_reintento',
    titulo: 'Cómo repetir la foto del carnet',
    cuerpo:
      'Para que el documento se lea bien: sin flash, bajo sombra, apoyado en una superficie mate y llenando la pantalla. El reflejo sobre el holograma es lo que más falla.',
    variables: [],
  },
  {
    code: 'rechazo_capacidad',
    titulo: 'Explicar un rechazo por capacidad',
    cuerpo:
      'No es por antecedentes. Con el ingreso que pudimos verificar, la cuota del monto solicitado queda por encima de lo que consideramos pagable. Con un monto menor o un plazo más largo el resultado puede cambiar.',
    variables: [],
  },
  {
    code: 'fraude_bloqueo',
    titulo: 'Aviso de bloqueo preventivo',
    cuerpo:
      'Bloqueamos tu cuenta para que nadie pueda usarla mientras investigamos. No vas a pagar los cargos que denunciás hasta que terminemos. Te contacto en menos de 24 horas.',
    variables: [],
  },
  {
    code: 'privacidad_acuse',
    titulo: 'Acuse de solicitud de datos',
    cuerpo:
      'Registramos tu solicitud sobre tus datos personales. Te entregamos el paquete dentro del plazo legal y por un canal donde tengas que identificarte.',
    variables: [],
  },
  {
    code: 'comercio_qr_ilegible',
    titulo: 'QR de cobro ilegible',
    cuerpo:
      'La imagen del QR llega cortada y no se alcanza a leer la entidad. Necesitamos la foto completa, con el código y el nombre del banco visibles.',
    variables: [],
  },
  {
    code: 'cierre_agradecimiento',
    titulo: 'Cierre del caso',
    cuerpo:
      'Dejo el caso como resuelto. Si algo no quedó como esperabas, respondé este mismo mensaje y lo reabrimos sin que tengas que explicarlo de nuevo.',
    variables: [],
  },
];

const respuestas = RESPUESTAS.map((r) => ({
  _tenant_id: T,
  response_code: r.code,
  version_number: 1,
  locale: 'es-BO',
  title: r.titulo,
  body_md: r.cuerpo,
  allowed_variables_json: r.variables,
  audience: 'CONSUMER',
  team_scope: 'soporte',
  status: 'published',
  published_at: '2026-06-01T00:00:00Z',
}));

interface ArticuloSemilla {
  readonly id: number;
  readonly clave: string;
  readonly categoria: string;
  readonly titulo: string;
  readonly pregunta: string;
  readonly respuestaCorta: string;
  readonly cuerpo: string;
  readonly escalar: string;
  readonly faq: boolean;
}

const ARTICULOS: ArticuloSemilla[] = [
  {
    id: 941101,
    clave: 'como-pago-mi-cuota',
    categoria: 'PAYMENTS',
    titulo: 'Cómo pago mi cuota',
    pregunta: '¿De qué maneras puedo pagar?',
    respuestaCorta: 'Desde la app con QR, por transferencia bancaria o en efectivo en cualquier comercio de la red.',
    cuerpo:
      '## Desde la app\n\nEntrá a **Mis cuotas**, elegí la que vence y tocá *Pagar*. Se genera un QR que sirve en cualquier banco.\n\n## Por transferencia\n\nUsá los datos que aparecen en la misma pantalla. **Importante:** la transferencia tiene que salir a tu nombre; si la hace otra persona, el pago no se acredita solo y hay que avisarnos.\n\n## En efectivo\n\nEn cualquier comercio de la red con el código de tu cuota.',
    escalar: 'Si el pago tiene más de 24 horas y sigue sin acreditarse, abrí un caso con el comprobante.',
    faq: true,
  },
  {
    id: 941102,
    clave: 'no-me-llega-el-codigo',
    categoria: 'AUTH_OTP_NOT_RECEIVED',
    titulo: 'No me llega el código de acceso',
    pregunta: '¿Qué hago si no recibo el código?',
    respuestaCorta: 'Esperá dos minutos, revisá la señal y confirmá que el número cargado sea el tuyo.',
    cuerpo:
      '1. Esperá dos minutos: el mensaje puede demorar.\n2. Comprobá que tengas señal y que el teléfono no esté en modo avión.\n3. Revisá que el número que ves en pantalla sea el tuyo, dígito por dígito.\n4. Si todo está bien, pedí un código nuevo — el anterior deja de servir.',
    escalar: 'Si el número que aparece no es el tuyo, no lo cambies solo: abrí un caso, porque hay que verificar identidad antes.',
    faq: true,
  },
  {
    id: 941103,
    clave: 'por-que-me-rechazaron',
    categoria: 'CREDIT_DECISION_EXPLANATION',
    titulo: 'Por qué puede rechazarse un crédito',
    pregunta: '¿Por qué me dijeron que no?',
    respuestaCorta: 'Las razones más frecuentes son la capacidad de pago, el endeudamiento vigente o la identidad sin verificar.',
    cuerpo:
      'Un rechazo **no** significa que estés en una lista negra. Las razones que comunicamos son:\n\n- **La cuota no cabe en el ingreso comprobado.** Probá con un monto menor o un plazo más largo.\n- **Endeudamiento vigente alto.** Cuando bajen tus compromisos, volvé a intentarlo.\n- **Identidad no verificada.** Repetí la captura del documento.\n- **Cuota pendiente con nosotros.** Al regularizarla se habilita la línea.',
    escalar:
      'Si la persona insiste en conocer la fórmula del modelo, no se entrega: se explica el motivo comunicable y se ofrece la vía de reintento.',
    faq: true,
  },
  {
    id: 941104,
    clave: 'foto-del-carnet',
    categoria: 'KYC_DOCUMENT_REJECTED',
    titulo: 'Cómo sacar bien la foto del carnet',
    pregunta: '¿Por qué rechazan mi documento?',
    respuestaCorta: 'Casi siempre es el reflejo de la luz sobre el holograma, no el documento.',
    cuerpo:
      '- Sin flash y bajo sombra.\n- Apoyá el carnet sobre una superficie **mate** (no vidrio).\n- Que ocupe toda la pantalla, sin dedos encima de los datos.\n- Las dos caras, una por una.\n\nSi el nombre del carnet no coincide con el que cargaste al registrarte, corregí el nombre antes de repetir la foto.',
    escalar:
      'Tres intentos fallidos con confianza baja y sin discrepancia de nombre: derivar a revisión humana, no pedir un cuarto intento.',
    faq: true,
  },
  {
    id: 941105,
    clave: 'compras-que-no-hice',
    categoria: 'FRAUD_REPORT',
    titulo: 'Vi compras que no hice',
    pregunta: '¿Qué hago si hay movimientos desconocidos?',
    respuestaCorta: 'Avisanos de inmediato: bloqueamos la cuenta primero y investigamos después.',
    cuerpo:
      'Denunciá cuanto antes desde la app o por soporte. **Bloqueamos la cuenta apenas entra la denuncia**, antes de investigar: es más fácil desbloquear después que recuperar el dinero.\n\nMientras dure la investigación no tenés que pagar los cargos denunciados.',
    escalar: 'Todo reporte de fraude entra como P1 y se asigna a Seguridad, sin triaje intermedio.',
    faq: true,
  },
  {
    id: 941106,
    clave: 'mis-datos-personales',
    categoria: 'PRIVACY_REQUEST',
    titulo: 'Pedir, corregir o borrar mis datos',
    pregunta: '¿Cómo ejerzo mis derechos sobre mis datos?',
    respuestaCorta: 'Se piden por soporte y tienen un plazo legal propio.',
    cuerpo:
      'Podés pedir una **copia** de tus datos, **corregir** lo que esté mal o pedir la **supresión** de lo que ya no sea necesario.\n\nLa entrega se hace por un canal donde tengas que identificarte. Hay información que no se puede borrar mientras exista una obligación legal de conservarla — por ejemplo, la de un crédito vigente.',
    escalar: 'El plazo corre desde que entra la solicitud, no desde que se asigna. Si se acerca al 80 % del plazo, avisar a Cumplimiento.',
    faq: false,
  },
  {
    id: 941107,
    clave: 'qr-del-comercio',
    categoria: 'PARTNER_QR_TERMINAL',
    titulo: 'Subir el QR de cobro del comercio',
    pregunta: '¿Por qué mi QR sigue en revisión?',
    respuestaCorta: 'La imagen tiene que dejar ver el código completo y el nombre de la entidad.',
    cuerpo:
      'Revisamos a mano cada QR de cobro porque es donde termina el dinero de las ventas.\n\nPara que se apruebe:\n\n- La foto completa, sin recortes.\n- El nombre de la entidad **legible**.\n- La cuenta a nombre del comercio, no de una persona.',
    escalar: 'Un QR cuyo titular no coincide con la razón social no se aprueba: se escala a Comercios.',
    faq: false,
  },
  {
    id: 941108,
    clave: 'conciliacion-del-comercio',
    categoria: 'PARTNER_RECONCILIATION',
    titulo: 'Entender la liquidación diaria',
    pregunta: '¿Por qué la liquidación no coincide con mis ventas?',
    respuestaCorta: 'El corte es a las 18:00; lo que pasa después entra en la liquidación siguiente.',
    cuerpo:
      'La liquidación toma las ventas **hasta las 18:00**. Una venta o una anulación posterior sale en el día siguiente.\n\nA eso se le descuenta la comisión pactada, que figura en el contrato del comercio.',
    escalar:
      'Si la diferencia no se explica por corte ni por comisión, abrir caso en Comercios · operaciones con el detalle de las ventas.',
    faq: false,
  },
];

const articulos = ARTICULOS.map((a) => ({
  _id: a.id,
  _tenant_id: T,
  article_key: a.clave,
  audience: 'PUBLIC_CONSUMER',
  category_id: refA('support.support_case_categories', { _tenant_id: T, category_code: a.categoria, catalog_version: 1 }),
  status: 'PUBLISHED',
  owner_team: 'support',
  is_faq: a.faq,
  is_featured: a.faq,
  review_cycle_days: 180,
  next_review_at: '2027-03-01T00:00:00Z',
  helpful_count: 12 + (a.id % 40),
  not_helpful_count: a.id % 5,
  display_order: (a.id - 941100) * 10,
  _created_at: '2026-06-01T00:00:00Z',
  _updated_at: '2026-06-01T00:00:00Z',
  _deleted: false,
}));

const versionesArticulo = ARTICULOS.map((a) => ({
  _id: 941200 + (a.id - 941100),
  _tenant_id: T,
  article_id: a.id,
  version_number: 1,
  locale: 'es-BO',
  status: 'PUBLISHED',
  title: a.titulo,
  question: a.pregunta,
  short_answer: a.respuestaCorta,
  body_markdown: a.cuerpo,
  tags_json: [a.categoria.toLowerCase()],
  canonical_query_terms_json: a.pregunta.toLowerCase().replace('¿', '').replace('?', '').split(' ').slice(0, 6),
  escalate_when: a.escalar,
  approved_at: '2026-06-01T00:00:00Z',
  published_at: '2026-06-01T00:00:00Z',
  checksum: sha256Hex(a.cuerpo),
  _created_at: '2026-06-01T00:00:00Z',
  _updated_at: '2026-06-01T00:00:00Z',
}));

export const SOPORTE: DominioSembrado = {
  nombre: 'soporte',
  descripcion: 'Mesa de soporte completa: 8 colas, 4 acuerdos, 22 categorías, 6 agentes, 10 casos con su conversación y 8 artículos.',
  bloques: [
    { tabla: 'support.support_queues', filas: colas, conflicto: ['_tenant_id', 'queue_code'] },
    { tabla: 'support.support_sla_policies', filas: acuerdos, conflicto: ['_tenant_id', 'policy_code', 'priority', 'version_number'] },
    { tabla: 'support.support_case_categories', filas: categorias, conflicto: ['_tenant_id', 'category_code', 'catalog_version'] },
    { tabla: 'support.support_agent_profiles', filas: agentes, conflicto: ['_tenant_id', 'internal_user_id'] },
    { tabla: 'support.support_cases', filas: casos },
    { tabla: 'support.support_channels', filas: canales, conflicto: ['_tenant_id', 'channel_code'] },
    { tabla: 'support.support_messages', filas: mensajes, soloAnadir: true },
    { tabla: 'support.support_case_events', filas: eventos, soloAnadir: true },
    { tabla: 'support.support_assignments', filas: asignaciones },
    { tabla: 'support.support_resolutions', filas: resoluciones },
    { tabla: 'support.support_case_feedback', filas: encuestas },
    {
      tabla: 'support.support_canned_responses',
      filas: respuestas,
      conflicto: ['_tenant_id', 'response_code', 'locale', 'version_number'],
    },
    { tabla: 'support.knowledge_articles', filas: articulos, conflicto: ['_tenant_id', 'article_key'] },
    { tabla: 'support.knowledge_article_versions', filas: versionesArticulo, conflicto: ['article_id', 'locale', 'version_number'] },
  ],
};
