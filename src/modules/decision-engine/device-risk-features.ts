/**
 * @file Las señales del TELÉFONO traducidas a features del Motor: ubicación, dispositivo, comportamiento del alta y agenda.
 * @business Atlas ya recoge el rastro de ubicación, la agenda, la huella del dispositivo y la bitácora del alta, y hasta
 *   aquí ninguna decisión de crédito las leía: viajaban como `ausente` con valor neutro. Esto las convierte en números
 *   declarados, con procedencia, para que la política las pueda usar —primero en sombra, después con autoridad—.
 * @system función pura; no consulta nada. Las lecturas viven en `UnderwritingDeviceSignalsService`.
 */

/** Una posición tal como la necesita el cálculo. `distanceToDeclaredMeters` la calcula el servidor al recibirla. */
export type PingObservado = {
  capturedAt: Date;
  captureMode: string;
  isMocked: boolean;
  distanceToDeclaredMeters: number | null;
};

export type SnapshotDeDispositivo = { isRooted: boolean | null; isEmulator: boolean | null };

export type ComportamientoObservado = { botLikelihoodScore: number | null };

export type AgendaObservada = {
  /** Hay fichas guardadas (sincronización completa con consentimiento). */
  available: boolean;
  totalContacts: number;
  /** Teléfonos de la agenda que están en la lista de vigilancia activa. */
  watchlistMatches: number;
  /** Otros clientes que comparten al menos `UMBRAL_ANILLO_CONTACTOS` teléfonos con esta agenda. */
  ringCustomers: number;
};

export type EntradasDeSeñalesDelTelefono = {
  pings: readonly PingObservado[];
  snapshots: readonly SnapshotDeDispositivo[];
  /** Otros clientes vinculados a alguno de los dispositivos de este cliente. */
  sharedDeviceCustomers: number;
  comportamiento: ComportamientoObservado | null;
  agenda: AgendaObservada;
};

/** Ventana del rastro que se mira. Treinta días: cubre un ciclo de sueldo y no arrastra mudanzas viejas. */
export const VENTANA_PINGS_DIAS = 30;
/** Bolivia no tiene horario de verano: UTC−4 todo el año. */
const DESPLAZAMIENTO_BOLIVIA_HORAS = -4;
/** Radio en el que una posición nocturna cuenta como «en casa». Cubre el error de un GPS en `Balanced`. */
export const RADIO_CASA_M = 300;
/** Compartir tres o más teléfonos con otra agenda deja de ser casualidad (familia aparte) y empieza a ser anillo. */
export const UMBRAL_ANILLO_CONTACTOS = 3;
/**
 * Corte del `botLikelihoodScore`. El mismo 0,7 del artefacto de identidad (`COMPORTAMIENTO_AUTOMATIZADO`).
 * NO está calibrado: es el valor de partida que la sombra debe confirmar o mover (plan F5.2).
 */
export const CORTE_AUTOMATIZACION = 0.7;

/** Versión del cálculo. Viaja en el contexto: un cambio de fórmula tiene que poder distinguirse al recalibrar. */
export const VERSION_SEÑALES_DEL_TELEFONO = 'device-signals-1.0.0';

export type SeñalesDelTelefono = {
  version: string;
  geo: {
    available: boolean;
    pingsCount: number;
    backgroundPings: number;
    coverageHours: number;
    homeDistanceP50Meters: number | null;
    nightPings: number;
    nightAtHomeRatio: number | null;
    mockedCount: number;
  };
  device: {
    available: boolean;
    rootedOrEmulator: boolean | null;
    sharedDeviceCustomers: number;
    riskScore: number;
  };
  behavior: { available: boolean; botLikelihoodScore: number | null };
  contacts: AgendaObservada;
  /** Lo que se mandaría al artefacto de crédito, con su procedencia. Sólo se usa en modo `live`. */
  variables: Record<string, { value: unknown; available: boolean }>;
};

function mediana(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(orden.length / 2);
  return orden.length % 2 === 0 ? (orden[mitad - 1]! + orden[mitad]!) / 2 : orden[mitad]!;
}

/** Hora local de Bolivia de una marca UTC. */
function horaBolivia(fecha: Date): number {
  return (fecha.getUTCHours() + 24 + DESPLAZAMIENTO_BOLIVIA_HORAS) % 24;
}

const esNoche = (fecha: Date) => {
  const hora = horaBolivia(fecha);
  return hora >= 22 || hora < 6;
};

const redondear = (valor: number, decimales: number) => Number(valor.toFixed(decimales));

/**
 * Las señales del teléfono de un cliente.
 *
 * ## Qué se AFIRMA y qué no
 *
 * Igual que en `UnderwritingSignalsService.complianceSignals`: sólo un hecho positivo se afirma. Una posición con
 * `is_mocked` (lo dice el sistema operativo) es un hecho; que no haya ninguna no prueba que la ubicación sea real si
 * apenas hay posiciones. Por eso cada variable lleva `available`, y sin materia prima viaja ausente —nunca «limpio»—.
 *
 * ## `device_risk_score`
 *
 * Suma declarada y acotada a 100: emulador 50, root 40, ubicación simulada 30, dispositivo compartido con otros dos o
 * más clientes 30. Los pesos son de partida (plan F5): ordenan, no están calibrados.
 */
export function calcularSeñalesDelTelefono(entradas: EntradasDeSeñalesDelTelefono): SeñalesDelTelefono {
  const pings = entradas.pings;
  const distancias = pings.map((p) => p.distanceToDeclaredMeters).filter((d): d is number => d !== null && Number.isFinite(d));
  const nocturnas = pings.filter((p) => esNoche(p.capturedAt) && p.distanceToDeclaredMeters !== null);
  const nocturnasEnCasa = nocturnas.filter((p) => (p.distanceToDeclaredMeters ?? Infinity) <= RADIO_CASA_M).length;
  const horas = new Set(pings.map((p) => Math.floor(p.capturedAt.getTime() / 3_600_000)));
  const mockedCount = pings.filter((p) => p.isMocked).length;
  const p50 = mediana(distancias);

  const geo = {
    available: pings.length > 0,
    pingsCount: pings.length,
    backgroundPings: pings.filter((p) => p.captureMode === 'background').length,
    coverageHours: horas.size,
    homeDistanceP50Meters: p50 === null ? null : Math.round(p50),
    nightPings: nocturnas.length,
    nightAtHomeRatio: nocturnas.length === 0 ? null : redondear(nocturnasEnCasa / nocturnas.length, 3),
    mockedCount,
  };

  const conDato = entradas.snapshots.filter((s) => s.isRooted !== null || s.isEmulator !== null);
  const rooted = conDato.some((s) => s.isRooted === true);
  const emulator = conDato.some((s) => s.isEmulator === true);
  const rootedOrEmulator = conDato.length === 0 ? null : rooted || emulator;
  const compartido = entradas.sharedDeviceCustomers >= 2;
  const riskScore = Math.min(100, (emulator ? 50 : 0) + (rooted ? 40 : 0) + (mockedCount > 0 ? 30 : 0) + (compartido ? 30 : 0));
  const device = {
    available: conDato.length > 0 || geo.available,
    rootedOrEmulator,
    sharedDeviceCustomers: entradas.sharedDeviceCustomers,
    riskScore,
  };

  const bot = entradas.comportamiento?.botLikelihoodScore ?? null;
  const behavior = { available: bot !== null, botLikelihoodScore: bot };

  const agenda = entradas.agenda;
  const variables: SeñalesDelTelefono['variables'] = {
    // Sólo la posición simulada es un hecho: el resto de la geografía es contexto hasta que la sombra mida cortes.
    geolocation_mismatch_flag: { value: mockedCount > 0, available: mockedCount > 0 || pings.length >= 10 },
    device_risk_score: { value: riskScore, available: device.available },
    browser_automation_detected: { value: bot !== null && bot >= CORTE_AUTOMATIZACION, available: bot !== null },
    /*
     * La agenda NO se mapea a `known_fraud_phone_flag`: esa variable dice que el teléfono DEL SOLICITANTE es de
     * fraude, y la compuerta G3 rechaza con ella. Que un contacto suyo esté en la lista es un hecho sobre un
     * tercero; viaja como contexto (`contacts`) para medirlo en sombra, nunca como veredicto sobre la persona.
     */
  };

  return { version: VERSION_SEÑALES_DEL_TELEFONO, geo, device, behavior, contacts: agenda, variables };
}

/**
 * Las variables que SUSTITUYEN a las ausentes del expediente de crédito, y sólo en modo `live`.
 *
 * En `shadow` devuelve vacío: las variables quedan como estaban y la decisión es idéntica a la de antes; lo nuevo
 * viaja en el contexto de la ejecución para medirlo contra lo que decidió la persona (plan F4). Una variable sin
 * materia prima tampoco sale: ausente sigue siendo ausente.
 */
export function variablesEnVivo(señales: SeñalesDelTelefono | null, modo: 'shadow' | 'live'): [string, unknown][] {
  if (!señales || modo !== 'live') return [];
  return Object.entries(señales.variables)
    .filter(([, señal]) => señal.available)
    .map(([codigo, señal]) => [codigo, señal.value]);
}
