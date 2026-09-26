/**
 * @file Qué es cada decisión que Atlas delega en el Motor, contado para quien la lee en la pantalla.
 * @business Responde «¿para qué sirve esta decisión y qué se rompe si la cambio?» sin leer el código.
 * @system catálogo estático por tipo de decisión: quién la llama, en qué punto del recorrido y qué devuelve.
 */
import { DecisionType } from './decision-artifact-binding.service.js';

/**
 * Quien llama a cada decision y en que momento del recorrido.
 *
 * Esta declarado aqui, junto al codigo que lo ejecuta, y NO en la base: es un hecho del sistema, no
 * una preferencia. Si manana un servicio nuevo llama a la politica de credito, esta constante es lo
 * que hay que actualizar —y el que la lea sabra que la lista es exacta, no lo que alguien anoto una
 * vez—. La base guarda lo que el operador decide; esto guarda lo que el codigo hace.
 */
interface CatalogEntry {
  title: string;
  description: string;
  /** Para que le sirve al negocio, con un ejemplo concreto de cuando importa. */
  business: string;
  /** Que hace por dentro: que se le manda al motor y que devuelve. */
  systems: string;
  example: string;
  endpoints: { method: string; path: string; purpose: string }[];
  stage: string;
  /** Los pasos del recorrido en los que participa, en orden. */
  workflowSteps: string[];
}

const DECISION_CATALOG: Record<DecisionType, CatalogEntry> = {
  identity: {
    title: 'Identidad',
    description: 'Decide si la persona del carnet es quien dice ser.',
    business:
      'Es la puerta de entrada del alta: hasta que esta decision no dice que si, no hay cliente al que prestarle. Una politica demasiado estricta rechaza a gente que si es quien dice, y una demasiado laxa deja pasar una suplantacion —que en un credito significa prestarle dinero a alguien que nunca lo va a devolver porque nunca lo pidio—.',
    systems:
      'Se le mandan las tres imagenes en base64 —anverso, reverso y selfie— y el pais del documento. El artefacto llama al worker de identidad, que lee la MRZ, extrae el retrato del carnet y lo compara con la selfie. Devuelve VERIFICADO, RECHAZADO o REVISION_HUMANA con el parecido medido.',
    example:
      'Un parecido de 0,90 sobre un umbral calibrado de 0,8824 aprueba; uno de 0,80 cae en la franja ambigua y se deriva a un analista, que ve el carnet y la selfie antes de decidir.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/v1/mobile/identity-verifications',
        purpose: 'La app movil envia las fotos y consulta el veredicto.',
      },
      {
        method: 'POST',
        path: '/api/v1/customer-onboarding/:customerId/identity-package',
        purpose: 'El alta registra el paquete de identidad y dispara la verificacion.',
      },
    ],
    stage: 'Alta del cliente · verificacion de identidad',
    workflowSteps: [
      'El cliente fotografia su carnet y se toma una selfie',
      'Las imagenes suben cifradas con URL firmada',
      'El artefacto decide: verificado, rechazado o a revision humana',
      'Si va a revision, el caso entra en la cola IDENTIDAD del motor',
      'La decision del analista vuelve al expediente y desbloquea el alta',
    ],
  },
  credit: {
    title: 'Credito',
    description: 'Decide si se aprueba una solicitud, con que limite y en cuantas cuotas.',
    business:
      'Es la decision que pone dinero en la calle. Determina cuanto se presta y a quien, asi que gobierna directamente la mora de la cartera: aflojarla sube las ventas hoy y la morosidad en tres meses.',
    systems:
      'Se le mandan los rasgos economicos declarados y verificados del cliente —ingresos, gastos, antiguedad, actividad— junto con su historial. Devuelve aprobado o rechazado, el limite y si necesita aceptacion del comercio.',
    example:
      'Una solicitud de Bs 1.500 a tres cuotas con ingreso declarado de Bs 8.500 y gastos de Bs 3.200 se aprueba; la misma solicitud con gastos de Bs 8.000 no deja capacidad de pago y se rechaza.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/v1/customers/:customerId/credit-applications',
        purpose: 'El cliente solicita un credito desde la app.',
      },
      {
        method: 'POST',
        path: '/api/v1/operations/customers/:customerId/credit-line/recalculate',
        purpose: 'Operaciones recalcula la linea de un cliente.',
      },
    ],
    stage: 'Originacion · solicitud y linea de credito',
    workflowSteps: [
      'El cliente pide un credito, opcionalmente en un comercio',
      'El artefacto evalua su capacidad de pago',
      'Si aprueba, el comercio confirma la venta',
      'Se desembolsa y nace el calendario de cuotas',
    ],
  },
  partner: {
    title: 'Comercio (KYB)',
    description: 'Decide si el expediente de un comercio esta completo para habilitarlo a cobrar.',
    business:
      'Un comercio verificado puede cobrar: sus QR resuelven y sus ventas se le atribuyen. Aflojar esto habilita a cobrar a quien no ha dicho a que cuenta va el dinero; apretarlo de mas deja sin operar a comercios legitimos que ya firmaron. Antes esta decision no tenia politica versionada: la firmaba una persona en el portal y no habia forma de mover un umbral sin tocar codigo.',
    systems:
      'Se le mandan SIETE booleanos y numeros derivados del expediente —matricula, representante acreditado, los dos QR, correo probado, sucursales y antiguedad—, nunca los documentos: la evidencia con su hash se queda en Atlas. Devuelve APROBADO, RECHAZADO o REVISION_MANUAL, y en el ultimo caso abre su propio caso en la cola MERCHANT_KYB.',
    example:
      'Un expediente completo con el correo sin verificar no se rechaza ni se aprueba: sale a revision, y el analista ve en el caso que lo unico pendiente es el correo.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/v1/partner-onboarding/:partnerId/submit',
        purpose: 'El comercio termina su expediente y lo envia.',
      },
      {
        method: 'POST',
        path: '/api/v1/operations/partners/:partnerId/kyb-review',
        purpose: 'Operaciones —o el ERP por su pasarela— pide la verificacion.',
      },
    ],
    stage: 'Alta del comercio · verificacion del expediente',
    workflowSteps: [
      'El comercio completa su expediente y lo envia',
      'El artefacto evalua requisitos duros y señales operativas',
      'Aprobado habilita el cobro; rechazado dice que falta',
      'Con señales, el Motor abre caso en la cola MERCHANT_KYB',
      'La resolucion del caso vuelve al expediente',
    ],
  },
  risk: {
    title: 'Riesgo',
    description: 'Evalua el riesgo del cliente de forma continua.',
    business:
      'No decide una operacion concreta: vigila al cliente despues de tenerlo. Es lo que permite ajustar un limite antes de que la mora ocurra, en vez de reaccionar cuando ya ocurrio.',
    systems:
      'Opcional. Sin artefacto asignado no se consulta y el resto del sistema funciona igual; con el, se evalua al cliente contra la politica de riesgo vigente.',
    example: 'Un cliente que empieza a pagar tarde de forma sistematica puede ver su linea reducida antes de caer en impago.',
    endpoints: [
      {
        method: '—',
        path: 'Evaluacion interna, sin endpoint publico',
        purpose: 'Lo dispara el propio backend al recalcular riesgo.',
      },
    ],
    stage: 'Riesgo continuo · evaluacion del cliente',
    workflowSteps: [
      'El backend recalcula el riesgo del cliente',
      'Si hay artefacto asignado, se consulta la politica',
      'El resultado alimenta limites y alertas',
    ],
  },
};

/** Lo que el CODIGO hace con cada decision: quien la llama, donde vive y que decide. */
export function catalogo(decisionType: DecisionType) {
  const entry = DECISION_CATALOG[decisionType];
  return {
    title: entry.title,
    consumerEndpoints: entry.endpoints,
    workflowStage: entry.stage,
    workflowSteps: entry.workflowSteps,
    description: entry.description,
    business: entry.business,
    systems: entry.systems,
    example: entry.example,
  };
}
