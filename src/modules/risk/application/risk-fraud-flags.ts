/**
 * @file Las banderas de fraude del alta: lo que el teléfono, la red y el cronómetro dicen de quien se registra.
 * @business Un bot o un alta fabricada puede traer un carnet correcto y un teléfono verificado. Lo que no puede
 *   disimular a la vez es el dispositivo desde el que entra, la red, el ritmo con que rellena y la agenda que trae.
 *   Con una bandera fuerte —o dos medias— el alta la mira una persona.
 * @system función pura; las lecturas viven en `LocalRiskFraudFactsReader`. Sólo DERIVA: nunca aprueba ni rechaza.
 */

/** Los hechos que la base ya guarda de un alta. `null` = no se pudo leer o no hay dato; nunca cuenta en contra. */
export type RiskFraudFacts = {
  /** Algún snapshot del dispositivo dice emulador / root (lo informa la app). */
  emulator: boolean | null;
  rooted: boolean | null;
  /** Posiciones con `is_mocked` (lo dice el sistema operativo). */
  mockedLocationPings: number;
  /** Otros clientes vinculados a alguno de los dispositivos de éste. */
  sharedDeviceCustomers: number;
  /** Otros clientes con sesión desde alguna de las IP de éste en las últimas 24 h. */
  sameIpCustomers24h: number;
  /** Dispositivos distintos con los que este cliente abrió sesión durante el alta. */
  sessionDevices: number;
  /** `botLikelihoodScore` del último resumen de comportamiento (0-1). */
  botScore: number | null;
  /** Señales de ritmo del último resumen (`onboarding-behavior-summary.ritmo.ts`). */
  rhythmSignals: readonly string[];
  /** Señales de la forma de la agenda (`contact-book-shape.util.ts`); vacío si no compartió agenda. */
  contactSignals: readonly string[];
  /** Si hay agenda guardada. No compartirla no cuenta en contra. */
  contactsAvailable: boolean;
  contactsTotal: number | null;
  /** Días desde que el servidor vio aparecer el último contacto; `null` hasta la segunda sincronización. */
  contactsDaysSinceLastNew: number | null;
};

export const SIN_HECHOS_DE_FRAUDE: RiskFraudFacts = {
  emulator: null,
  rooted: null,
  mockedLocationPings: 0,
  sharedDeviceCustomers: 0,
  sameIpCustomers24h: 0,
  sessionDevices: 0,
  botScore: null,
  rhythmSignals: [],
  contactSignals: [],
  contactsAvailable: false,
  contactsTotal: null,
  contactsDaysSinceLastNew: null,
};

/** El mismo corte del artefacto de identidad (`COMPORTAMIENTO_AUTOMATIZADO`). */
export const CORTE_BOT = 0.7;
/** Un teléfono compartido en casa existe; el mismo teléfono en tres cuentas ya no es una familia. */
export const DISPOSITIVO_COMPARTIDO_FUERTE = 2;
/**
 * Bolivia sale a internet por CGNAT: decenas de personas legítimas comparten IP con su operadora. Por eso el corte
 * fuerte es alto (una ráfaga), y por debajo sólo cuenta como media.
 */
export const IP_RAFAGA_FUERTE = 8;
export const IP_RAFAGA_MEDIA = 4;
/** Empezar el alta en un teléfono y terminarla en otro pasa; en tres, no. */
export const DISPOSITIVOS_DE_SESION_FUERTE = 3;

/** Señales de ritmo que por sí solas no las produce una persona. */
const RITMO_FUERTE: ReadonlySet<string> = new Set(['TOQUES_SOBREHUMANOS', 'CAPTURA_INSTANTANEA']);
/** Contexto: se anota y se enseña, pero no suma para derivar. */
const SOLO_CONTEXTO: ReadonlySet<string> = new Set(['ALTA_DE_MADRUGADA']);

export type RiskFraudFlags = {
  strong: string[];
  medium: string[];
  context: string[];
  /** Una fuerte, o dos medias: el alta va a una persona. */
  escalate: boolean;
};

/**
 * Las banderas de un alta.
 *
 * ## Por qué dos niveles
 *
 * Cada bandera MEDIA tiene una explicación inocente frecuente —teléfono con root de un aficionado, agenda corta de un
 * teléfono nuevo, IP de la operadora—, y derivar por una sola llenaría la cola de gente normal. Dos a la vez ya no son
 * casualidad. Las FUERTES no tienen explicación inocente habitual: un emulador, una ubicación simulada por el sistema,
 * el mismo teléfono en tres cuentas, tiempos que un dedo no da.
 *
 * ## Qué NO hace
 *
 * Rechazar. Los cortes son de partida y no están medidos contra altas reales; el coste de equivocarse aquí tiene que
 * ser «una persona lo mira», no «alguien legítimo se queda fuera».
 */
export function evaluarBanderasDeFraude(hechos: RiskFraudFacts): RiskFraudFlags {
  const strong: string[] = [];
  const medium: string[] = [];
  const context: string[] = [];
  deDispositivoYRed(hechos, strong, medium);
  deComportamiento(hechos, strong, medium, context);
  for (const señal of hechos.contactSignals) medium.push(señal);
  return { strong, medium, context, escalate: strong.length >= 1 || medium.length >= 2 };
}

/** Con qué teléfono y desde qué red entró: lo que la base guarda de cada sesión. */
function deDispositivoYRed(hechos: RiskFraudFacts, strong: string[], medium: string[]): void {
  if (hechos.emulator === true) strong.push('EMULADOR');
  if (hechos.rooted === true) medium.push('DISPOSITIVO_CON_ROOT');
  if (hechos.mockedLocationPings > 0) strong.push('UBICACION_SIMULADA');

  if (hechos.sharedDeviceCustomers >= DISPOSITIVO_COMPARTIDO_FUERTE) strong.push('DISPOSITIVO_EN_VARIAS_CUENTAS');
  else if (hechos.sharedDeviceCustomers === 1) medium.push('DISPOSITIVO_COMPARTIDO');

  if (hechos.sameIpCustomers24h >= IP_RAFAGA_FUERTE) strong.push('RAFAGA_DE_ALTAS_DESDE_LA_IP');
  else if (hechos.sameIpCustomers24h >= IP_RAFAGA_MEDIA) medium.push('VARIAS_ALTAS_DESDE_LA_IP');

  if (hechos.sessionDevices >= DISPOSITIVOS_DE_SESION_FUERTE) strong.push('ALTA_DESDE_VARIOS_DISPOSITIVOS');
}

/** Cómo rellenó el alta: la heurística de automatización y el ritmo del cronómetro. */
function deComportamiento(hechos: RiskFraudFacts, strong: string[], medium: string[], context: string[]): void {
  if (hechos.botScore !== null && hechos.botScore >= CORTE_BOT) strong.push('COMPORTAMIENTO_AUTOMATIZADO');
  for (const señal of hechos.rhythmSignals) {
    if (SOLO_CONTEXTO.has(señal)) context.push(señal);
    else if (RITMO_FUERTE.has(señal)) strong.push(señal);
    else medium.push(señal);
  }
}

/** Cuántas señales de ritmo son fuertes y cuántas medias (las de contexto no cuentan). Es lo que viaja al Motor. */
export function contarRitmo(señales: readonly string[]): { strong: number; medium: number } {
  const strong = señales.filter((s) => RITMO_FUERTE.has(s)).length;
  return { strong, medium: señales.filter((s) => !RITMO_FUERTE.has(s) && !SOLO_CONTEXTO.has(s)).length };
}
