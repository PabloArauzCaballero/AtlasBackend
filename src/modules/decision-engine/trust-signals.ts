/**
 * @file Las señales de fraude de los registros propios de Atlas, traducidas a variables del Motor.
 * @business «Este teléfono está en la lista negra» o «este dispositivo lo usó alguien con fraude confirmado» son hechos que
 *   Atlas ya tiene guardados; hasta aquí ninguna decisión de crédito los leía y viajaban como `ausente`.
 * @system función pura; no consulta nada. Las lecturas viven en `UnderwritingTrustSignalsService`.
 */

/** Ventana de las observaciones de IP que se miran. */
export const VENTANA_IP_DIAS = 90;

/** Versión del cálculo: un cambio de fórmula tiene que poder distinguirse al recalibrar. */
export const VERSION_SEÑALES_DE_CONFIANZA = 'trust-signals-1.0.0';

/** Estados de riesgo que el sistema escribe en `devices.risk_status` y `global_device_fingerprints.global_risk_status`. */
const ESTADOS_BLOQUEADOS = ['blocked', 'blocklisted', 'fraud', 'confirmed_fraud'];
const ESTADOS_SOSPECHOSOS = ['high', 'suspicious', 'review', 'medium'];

export type EntradasDeConfianza = {
  /** `checkable`: el cliente tiene ese dato; `listed`: su hash está en una lista negra vigente. */
  phone: { checkable: boolean; listed: boolean };
  email: { checkable: boolean; listed: boolean };
  /** Casos de fraude CERRADOS del cliente cuya resolución no lo exculpa. */
  previousFraudCases: number;
  devices: readonly { riskStatus: string | null; globalRiskStatus: string | null; sharedWithFraudster: boolean }[];
  ipObservations: readonly { isVpn: boolean; isProxy: boolean; isTor: boolean; reputationScore: number | null }[];
};

export type SeñalDeConfianza = {
  value: unknown;
  /** Atlas pudo hacer el cotejo. Sin materia prima la variable sigue ausente: nunca «limpio» por no haber mirado. */
  available: boolean;
  /**
   * `fact`: coincidencia exacta con un registro humano (lista negra, caso cerrado). `heuristic`: puntaje de partida sin
   * calibrar; sólo decide cuando el modo de las señales del teléfono es `live`, como las demás.
   */
  kind: 'fact' | 'heuristic';
};

export type SeñalesDeConfianza = {
  version: string;
  variables: Record<string, SeñalDeConfianza>;
};

const norm = (valor: string | null) => (valor ?? '').trim().toLowerCase();
const en = (lista: readonly string[], valor: string | null) => lista.includes(norm(valor));

/** Puntaje 0..100 de la IP: el peor de lo observado. Tor 90, VPN o proxy 40, y el puntaje del proveedor si lo trae. */
function puntajeDeIp(observaciones: EntradasDeConfianza['ipObservations']): number {
  let peor = 0;
  for (const o of observaciones) {
    const proveedor =
      o.reputationScore === null || !Number.isFinite(o.reputationScore)
        ? 0
        : o.reputationScore <= 1
          ? o.reputationScore * 100
          : o.reputationScore;
    peor = Math.max(peor, proveedor, o.isTor ? 90 : 0, o.isVpn || o.isProxy ? 40 : 0);
  }
  return Math.min(100, Math.round(peor));
}

/**
 * Las señales de confianza de un cliente.
 *
 * Una coincidencia es un hecho; la ausencia de coincidencia sólo vale si Atlas HIZO el cotejo: sin teléfono no se cotejó el
 * teléfono, y sin dispositivos vinculados no se cotejó ninguno. En esos casos la variable no se afirma.
 */
export function calcularSeñalesDeConfianza(entradas: EntradasDeConfianza): SeñalesDeConfianza {
  const { devices, ipObservations } = entradas;
  const bloqueado = devices.some((d) => en(ESTADOS_BLOQUEADOS, d.riskStatus) || en(ESTADOS_BLOQUEADOS, d.globalRiskStatus));
  const sospechoso = devices.some((d) => en(ESTADOS_SOSPECHOSOS, d.riskStatus) || en(ESTADOS_SOSPECHOSOS, d.globalRiskStatus));
  const compartidoConFraude = devices.some((d) => d.sharedWithFraudster);
  const hayDispositivos = devices.length > 0;
  const hayIp = ipObservations.length > 0;

  return {
    version: VERSION_SEÑALES_DE_CONFIANZA,
    variables: {
      known_fraud_phone_flag: { value: entradas.phone.listed, available: entradas.phone.checkable, kind: 'fact' },
      known_fraud_email_flag: { value: entradas.email.listed, available: entradas.email.checkable, kind: 'fact' },
      known_fraud_device_flag: { value: bloqueado || compartidoConFraude, available: hayDispositivos, kind: 'fact' },
      previous_fraud_case_flag: { value: entradas.previousFraudCases > 0, available: true, kind: 'fact' },
      // `TRUSTED` no se afirma nunca: Atlas no tiene con qué probar confianza, sólo desconfianza.
      device_reputation: {
        value: bloqueado ? 'BLOCKLISTED' : sospechoso || compartidoConFraude ? 'SUSPICIOUS' : 'NEUTRAL',
        available: hayDispositivos,
        kind: 'heuristic',
      },
      ip_address_risk_score: { value: puntajeDeIp(ipObservations), available: hayIp, kind: 'heuristic' },
      ip_tor_detected: { value: ipObservations.some((o) => o.isTor), available: hayIp, kind: 'heuristic' },
    },
  };
}

/**
 * Las variables que SUSTITUYEN a las ausentes. Los hechos viajan siempre; las heurísticas, sólo en `live`.
 * Lo que no se pudo cotejar no sale, y sigue ausente.
 */
export function variablesDeConfianza(señales: SeñalesDeConfianza | null, modo: 'shadow' | 'live'): [string, unknown][] {
  if (!señales) return [];
  return Object.entries(señales.variables)
    .filter(([, señal]) => señal.available && (señal.kind === 'fact' || modo === 'live'))
    .map(([codigo, señal]) => [codigo, señal.value]);
}

type Origen = 'expediente' | 'derivado' | 'ausente';

/**
 * Lo que viaja de fraude y dispositivo cuando Atlas NO pudo cotejar nada: valores neutros y marcados `ausente`.
 * Las señales de arriba pisan a las que sí se cotejaron. `put` registra la procedencia de cada variable.
 */
export function fraudDefaults(
  put: <T>(key: string, value: T, from: Origen) => T,
  openFraudCase: boolean,
  applications24h: number,
): Record<string, unknown> {
  return {
    /*
     * `NEUTRAL` y no `UNKNOWN`: el artefacto solo admite TRUSTED, NEUTRAL, SUSPICIOUS o BLOCKLISTED, y un valor fuera del
     * enum aborta la ejecución entera —el motor devolvió `VARIABLE_MISSING_OR_INVALID` y la línea se quedó sin calcular—.
     */
    device_reputation: put('device_reputation', 'NEUTRAL', 'ausente'),
    device_risk_score: put('device_risk_score', 0, 'ausente'),
    ip_address_risk_score: put('ip_address_risk_score', 0, 'ausente'),
    ip_tor_detected: put('ip_tor_detected', false, 'ausente'),
    geolocation_mismatch_flag: put('geolocation_mismatch_flag', false, 'ausente'),
    sim_swap_detected: put('sim_swap_detected', false, 'ausente'),
    browser_automation_detected: put('browser_automation_detected', false, 'ausente'),
    known_fraud_device_flag: put('known_fraud_device_flag', false, 'ausente'),
    known_fraud_email_flag: put('known_fraud_email_flag', false, 'ausente'),
    known_fraud_phone_flag: put('known_fraud_phone_flag', false, 'ausente'),
    previous_fraud_case_flag: put('previous_fraud_case_flag', false, 'ausente'),
    // Un caso de fraude ABIERTO es un hecho; su ausencia sólo dice que nadie abrió caso, no que no haya señal (C-6).
    fraud_signal: put('fraud_signal', openFraudCase ? true : null, openFraudCase ? 'expediente' : 'ausente'),
    account_takeover_risk_score: put('account_takeover_risk_score', 0, 'ausente'),
    velocity_applications_24h: put('velocity_applications_24h', applications24h, 'expediente'),
  };
}
