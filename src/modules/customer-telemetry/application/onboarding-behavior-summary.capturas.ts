/**
 * @file Cálculo puro de las cifras de captura (carnet y selfie) y del tiempo en segundo plano del resumen de comportamiento.
 * @business Dice cuántas imágenes se obtuvieron (carnet y selfie), cuántas salieron del escáner del sistema y si alguna se interrumpió, sin que el escáner cuente como «se fue de la app».
 * @system funciones puras sobre los pasos ORDENADOS de un flujo (`captura_<que>` y `flujo`); las usa `onboarding-behavior-summary.calculo.ts`.
 */
import type { DetalleDelResumen, PasoObservado } from './onboarding-behavior-summary.tipos.js';

/*
 * Las acciones que la app manda en `metadata.eventType` de un paso `captura_<que>`
 * (`features/bitacora/tipos.ts` en la app), y la secuencia real de cada camino:
 *
 * - Cámara de la app, desde el principio: `abre` → `toma` | `repite` | `cancela`. Un `segundo_plano`
 *   con la cámara abierta es la señal CAPTURA_INTERRUMPIDA: alguien que sale a por otra imagen.
 * - Escáner DEL SISTEMA (VisionKit / ML Kit): `abre` → `escanea` → `toma` | `repite` | `cancela`.
 *   `escanea` es que se ABRIÓ el escáner, no una imagen: la imagen es el `toma`/`repite` que llega
 *   después. En Android el escáner de ML Kit es otra actividad (Google Play Services), así que la app
 *   pasa a segundo plano sola mientras la persona escanea; la app marca esos `flujo` con
 *   `detail: 'escaner_sistema'`.
 * - Sin escáner (Expo Go, simulador, Android sin Play Services): `abre` → `escanea` →
 *   `respaldo_camara` → y desde ahí, la cámara de la app como siempre.
 *
 * La ingesta no tiene lista cerrada de acciones (`event_type` es texto), así que las nuevas ya se
 * guardaban; lo que faltaba era entenderlas.
 */
const ESCANER_ABIERTO = 'escanea';
const RESPALDO_DE_CAMARA = 'respaldo_camara';
const IMAGEN_OBTENIDA: ReadonlySet<string> = new Set(['toma', 'repite']);
/** Las acciones que NO cambian el estado de la captura: son la app yéndose y volviendo. */
const CAMBIO_DE_PLANO: ReadonlySet<string> = new Set(['segundo_plano', 'primer_plano']);
/** El `metadata.detail` de los `flujo` de segundo/primer plano mientras el escáner tiene la pantalla. */
export const DETALLE_ESCANER = 'escaner_sistema';

type CifrasDeCaptura = Required<
  Pick<
    DetalleDelResumen,
    'segundoPlanoDuranteCaptura' | 'capturasRepetidas' | 'capturasTomadas' | 'capturasEscaneadas' | 'respaldosDeCamara'
  >
>;

export function esPasoDeCaptura(paso: PasoObservado): boolean {
  return paso.stepCode.startsWith('captura_');
}

/**
 * Las cifras de captura de un flujo. `pasos` tiene que venir ordenado por tiempo.
 *
 * - `segundoPlanoDuranteCaptura`: un `captura_<que>:segundo_plano` con la CÁMARA de la app abierta.
 *   Si la última acción de esa captura fue `escanea`, quien tenía la pantalla era el escáner del
 *   sistema y la app no se fue a ningún sitio: no cuenta. Sin escáner, es exactamente la regla de
 *   siempre.
 * - `capturasTomadas`: imágenes obtenidas (`toma` + `repite`), de cámara o de escáner, INCLUIDA la
 *   selfie.
 * - `capturasEscaneadas`: de ellas, las que devolvió el escáner (la acción anterior de esa misma
 *   captura fue `escanea`).
 * - `respaldosDeCamara`: veces que no había escáner y la app cayó a su cámara.
 */
export function medirCapturas(pasos: PasoObservado[]): CifrasDeCaptura {
  const ultimaAccion = new Map<string, string>();
  const cifras: CifrasDeCaptura = {
    segundoPlanoDuranteCaptura: false,
    capturasRepetidas: 0,
    capturasTomadas: 0,
    capturasEscaneadas: 0,
    respaldosDeCamara: 0,
  };
  for (const paso of pasos) {
    if (!esPasoDeCaptura(paso)) continue;
    const anterior = ultimaAccion.get(paso.stepCode);
    if (paso.eventType === 'segundo_plano' && anterior !== ESCANER_ABIERTO) cifras.segundoPlanoDuranteCaptura = true;
    if (paso.eventType === 'repite') cifras.capturasRepetidas += 1;
    if (paso.eventType === RESPALDO_DE_CAMARA) cifras.respaldosDeCamara += 1;
    if (IMAGEN_OBTENIDA.has(paso.eventType)) {
      cifras.capturasTomadas += 1;
      if (anterior === ESCANER_ABIERTO) cifras.capturasEscaneadas += 1;
    }
    if (!CAMBIO_DE_PLANO.has(paso.eventType)) ultimaAccion.set(paso.stepCode, paso.eventType);
  }
  return cifras;
}

/**
 * Milisegundos en segundo plano: cada `flujo:segundo_plano` cerrado por el siguiente
 * `flujo:primer_plano`. `pasos` tiene que venir ordenado por tiempo.
 *
 * El rato dentro del escáner del sistema NO se descuenta: la persona sigue en el alta, escaneando su
 * carnet, y en iPhone (donde VisionKit no saca a la app del primer plano) ese tiempo ya cuenta. Se
 * reconoce por el `detail: 'escaner_sistema'` que pone la app o, si faltara, porque la última acción
 * de alguna captura es `escanea` (el escáner sigue abierto). Sin escáner, la resta es la de siempre.
 */
export function segundoPlanoMs(pasos: PasoObservado[]): number {
  let total = 0;
  let abierto: number | null = null;
  const escaneres = new Set<string>();
  for (const paso of pasos) {
    if (esPasoDeCaptura(paso)) {
      if (CAMBIO_DE_PLANO.has(paso.eventType)) continue;
      if (paso.eventType === ESCANER_ABIERTO) escaneres.add(paso.stepCode);
      else escaneres.delete(paso.stepCode);
      continue;
    }
    if (paso.stepCode !== 'flujo') continue;
    const delEscaner = paso.payload?.['detail'] === DETALLE_ESCANER || escaneres.size > 0;
    if (paso.eventType === 'segundo_plano') abierto = delEscaner ? null : paso.occurredAt.getTime();
    else if (paso.eventType === 'primer_plano' && abierto !== null) {
      total += Math.max(0, paso.occurredAt.getTime() - abierto);
      abierto = null;
    }
  }
  return total;
}
