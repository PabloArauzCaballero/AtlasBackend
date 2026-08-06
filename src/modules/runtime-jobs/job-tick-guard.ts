/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza evita que un trabajo de fondo se solape consigo mismo o se detenga sin aviso.
 * @system controla la reentrada y la duración de cada tanda del planificador de trabajos.
 */

/** Cómo terminó una tanda. `skipped_overlap` no es un fallo: es la protección haciendo su trabajo. */
export type TickOutcome = 'completed' | 'failed' | 'skipped_overlap';

export type JobTickGuardOptions = {
  /**
   * Plazo tras el cual una tanda se considera ATASCADA y se reporta. `0` desactiva el watchdog.
   * No cancela nada (una promesa de JavaScript no se puede cancelar): convierte un silencio en una
   * señal, que es lo que un operador necesita para actuar.
   */
  timeoutMs: number;
  /** Se invoca UNA vez por tanda que supera `timeoutMs`, con el tiempo transcurrido hasta ese punto. */
  onStall: (input: { jobCode: string; elapsedMs: number }) => void;
  /** Reloj y temporizador inyectables para tests deterministas. */
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => { clear: () => void };
};

function defaultTimer(callback: () => void, ms: number): { clear: () => void } {
  const timer = setTimeout(callback, ms);
  // Un watchdog no debe ser, por sí solo, motivo para mantener vivo el proceso.
  timer.unref?.();
  return { clear: () => clearTimeout(timer) };
}

/**
 * Guarda de ejecución de las tandas del planificador.
 *
 * Resuelve dos fallos que `setInterval` tiene por diseño y que en un backend financiero no son
 * teóricos:
 *
 * 1. **Solapamiento.** `setInterval` dispara pase lo que pase. Si una tanda de `process_events`
 *    tarda más que su intervalo, la siguiente arranca encima: el mismo proceso procesa el mismo
 *    lote dos veces en paralelo. El lock de liderazgo en Redis no lo impide —su TTL se acota al
 *    intervalo justamente para no distorsionar la cadencia, así que expira cuando llega el
 *    siguiente tick— y `FOR UPDATE SKIP LOCKED` protege las filas, pero no el resto del trabajo
 *    (entregas a proveedores, contadores, escrituras derivadas). La respuesta correcta a "la tanda
 *    anterior sigue corriendo" es saltarse esta, no acumular trabajo.
 *
 * 2. **Atasco silencioso.** Con el guard puesto, una tanda colgada bloquea su job PARA SIEMPRE: el
 *    job deja de correr y nada lo reporta, que es exactamente el modo de fallo más caro (la
 *    retención de datos personales deja de aplicarse y nadie se entera). El watchdog no puede
 *    cancelar la promesa, pero sí puede gritar: emite `onStall` una vez pasado el plazo, para que
 *    haya una métrica y un log que alerten.
 *
 * El hueco NO se libera al vencer el watchdog. Liberarlo permitiría que la tanda siguiente corriera
 * en paralelo con la atascada, que es el problema (1) reintroducido en el peor momento posible:
 * cuando ya hay algo funcionando mal. Se prefiere un job detenido y ruidoso a uno duplicado y
 * silencioso.
 */
export class JobTickGuard {
  private readonly startedAt = new Map<string, number>();
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => { clear: () => void };

  constructor(private readonly options: JobTickGuardOptions) {
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? defaultTimer;
  }

  /** `true` si hay una tanda de este job en vuelo (incluida una atascada). */
  isRunning(jobCode: string): boolean {
    return this.startedAt.has(jobCode);
  }

  /** Milisegundos que lleva corriendo la tanda en vuelo, o `null` si no hay ninguna. */
  runningForMs(jobCode: string): number | null {
    const started = this.startedAt.get(jobCode);
    return started === undefined ? null : this.now() - started;
  }

  /**
   * Ejecuta `fn` si no hay otra tanda del mismo job en vuelo.
   *
   * Nunca lanza: un fallo del handler se traduce a `failed` y se deja que el llamador lo registre.
   * Así una excepción dentro de un tick de `setInterval` no puede convertirse en un
   * `unhandledRejection` que tumbe el proceso.
   */
  async run(jobCode: string, fn: () => Promise<unknown>): Promise<TickOutcome> {
    if (this.isRunning(jobCode)) return 'skipped_overlap';

    const startedAt = this.now();
    this.startedAt.set(jobCode, startedAt);
    const watchdog =
      this.options.timeoutMs > 0
        ? this.setTimer(() => this.options.onStall({ jobCode, elapsedMs: this.now() - startedAt }), this.options.timeoutMs)
        : null;

    try {
      await fn();
      return 'completed';
    } catch {
      return 'failed';
    } finally {
      watchdog?.clear();
      this.startedAt.delete(jobCode);
    }
  }
}
