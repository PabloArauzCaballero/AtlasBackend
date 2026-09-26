/**
 * @file Adaptador de infraestructura: compuerta de admisión para pasos limitados por tasa.
 * @business Esta pieza respeta los límites anti-enumeración del backend en vez de apagarlos.
 * @system cubo de fichas por ventana; extraída de `scripts/qa` para compartirla con el worker.
 *
 * Compuerta de admisión para los pasos que el backend limita por tasa.
 *
 * `POST /customer-onboarding/start` está limitado a 10 intentos por minuto por IP —anti-enumeración,
 * declarado en el propio controlador— y veinte personas que arrancan a la vez desde una sola máquina
 * comparten esa IP. La primera corrida de veinte lo demostró: diez altas y diez
 * `RATE_LIMIT_EXCEEDED`.
 *
 * Hay dos formas de "arreglar" eso y una sola es correcta:
 *
 * - Subir o quitar el límite para que la corrida salga verde. Es exactamente lo que el paquete QA
 *   prohíbe: «mantén restricciones actuales de producción; no las borres para conseguir una corrida
 *   verde». Además convertiría la prueba en una medición de un sistema que no existe.
 * - Que el generador RESPETE el límite y lo declare. Eso es esto.
 *
 * La compuerta es un cubo de fichas: `limit` admisiones por `windowMs`, con espera hasta que se
 * libere una. Las personas siguen arrancando todas a la vez —el solapamiento real se conserva— y
 * sólo hacen cola en el paso limitado. Lo que se espera se MIDE (`admissionLagMs`): si la corrida
 * tarda más de lo previsto, el informe puede decir si fue el backend o la cola del propio generador.
 */
export class AdmissionGate {
  /** Marcas de tiempo de las admisiones concedidas dentro de la ventana vigente. */
  private readonly concedidas: number[] = [];
  private cola = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Espera hasta tener ficha. Devuelve cuánto esperó, que es el dato que importa reportar. */
  async admit(signal?: AbortSignal): Promise<{ admissionLagMs: number; queuedAhead: number }> {
    const pedidoEn = performance.now();
    const queuedAhead = this.cola;
    this.cola += 1;
    try {
      for (;;) {
        if (signal?.aborted) return { admissionLagMs: performance.now() - pedidoEn, queuedAhead };
        const ahora = Date.now();
        while (this.concedidas.length > 0 && ahora - this.concedidas[0] >= this.windowMs) this.concedidas.shift();
        if (this.concedidas.length < this.limit) {
          this.concedidas.push(ahora);
          return { admissionLagMs: performance.now() - pedidoEn, queuedAhead };
        }
        // Se duerme exactamente hasta que la ficha más vieja salga de la ventana, más un margen:
        // un sondeo cada 100 ms desperdiciaría vueltas y un cálculo justo se pasaría por redondeo.
        const esperaMs = this.windowMs - (ahora - this.concedidas[0]) + 25;
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, esperaMs);
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              resolve(undefined);
            },
            { once: true },
          );
        });
      }
    } finally {
      this.cola -= 1;
    }
  }
}
