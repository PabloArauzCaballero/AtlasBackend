/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza distingue «Brevo puede mandar un SMS» de «Brevo lo va a aceptar y luego tirarlo».
 * @system lee el saldo SMS del plan de la cuenta de Brevo y lo cachea, para no preguntarlo en cada envío.
 */

/**
 * Por qué hace falta preguntar el saldo ANTES de enviar.
 *
 * Brevo acepta la llamada de la API aunque la cuenta no tenga crédito de SMS: responde `201` con un
 * `messageId` y descarta el mensaje después, sin avisar por el callback. En su informe agregado
 * aparece como `rejected`, pero eso no llega a ATLAS por ningún camino. Resultado medido el
 * 2026-09-21 en TEST: 25 envíos del día con `accepted: 0`, `delivered: 0`, `rejected: 25`, y la
 * pantalla del alta diciendo «Código enviado» las 25 veces. Un día entero de alta parada, sin un
 * solo error en ningún log.
 *
 * `402 not_enough_credits` —que el adaptador ya trata como permanente— es el caso en que Brevo SÍ
 * lo dice; éste es el caso en que se lo calla. Por eso la comprobación es previa y no una lectura
 * del error.
 */
export type BrevoSmsCredit = Readonly<{
  /** `false` sólo cuando el plan se pudo leer y NO trae línea de SMS con saldo. */
  canSend: boolean;
  /** Créditos SMS vistos en el plan; `null` si no se pudo saber (se deja pasar el envío). */
  credits: number | null;
}>;

type PlanEntry = { type?: unknown; credits?: unknown; creditsType?: unknown };

function isSmsEntry(entry: PlanEntry): boolean {
  const type = typeof entry.type === 'string' ? entry.type.toLowerCase() : '';
  const creditsType = typeof entry.creditsType === 'string' ? entry.creditsType.toLowerCase() : '';
  return type === 'sms' || creditsType === 'sms';
}

/**
 * El saldo de SMS que declara `GET /v3/account`.
 *
 * El plan llega como una lista de líneas heterogéneas: la del plan gratuito es
 * `{type:"free", credits:300, creditsType:"sendLimit"}` —300 CORREOS al día, no SMS— y los SMS, si
 * los hay, vienen en su propia línea con `type` o `creditsType` en `sms`. Confundir las dos es
 * exactamente el error que llevó a creer que había 300 créditos disponibles.
 *
 * Ante una respuesta que no se entiende se devuelve `canSend: true` con `credits: null`: quedarse
 * sin mandar códigos porque Brevo cambió la forma de su respuesta sería peor que el problema que
 * esto resuelve. La política es «bloquea sólo cuando lo sabe».
 */
export function smsCreditFromAccount(body: unknown): BrevoSmsCredit {
  const plan = (body as { plan?: unknown } | null | undefined)?.plan;
  if (!Array.isArray(plan)) return { canSend: true, credits: null };

  const smsEntries = plan.filter((entry): entry is PlanEntry => Boolean(entry) && typeof entry === 'object').filter(isSmsEntry);
  if (smsEntries.length === 0) return { canSend: false, credits: 0 };

  const credits = smsEntries.reduce((total, entry) => total + (typeof entry.credits === 'number' ? entry.credits : 0), 0);
  return { canSend: credits > 0, credits };
}

/**
 * Caché con caducidad del saldo, para no añadir una llamada a Brevo por cada SMS.
 *
 * Diez minutos: bastante para que una campaña de mil mensajes pregunte una vez, y poco para que una
 * recarga se note sin reiniciar nada. La caché guarda también el «no se pudo saber», porque si Brevo
 * está caído no tiene sentido insistir en la misma petición a cada envío.
 */
export class BrevoSmsCreditCache {
  private cached: { value: BrevoSmsCredit; at: number } | null = null;

  constructor(private readonly ttlMs = 10 * 60 * 1000) {}

  read(now = Date.now()): BrevoSmsCredit | null {
    if (!this.cached || now - this.cached.at >= this.ttlMs) return null;
    return this.cached.value;
  }

  write(value: BrevoSmsCredit, now = Date.now()): BrevoSmsCredit {
    this.cached = { value, at: now };
    return value;
  }

  /** Tras una recarga o un cambio de clave, el saldo se vuelve a preguntar en el siguiente envío. */
  clear(): void {
    this.cached = null;
  }
}
