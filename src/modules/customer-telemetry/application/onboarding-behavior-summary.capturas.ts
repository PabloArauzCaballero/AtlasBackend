/**
 * @file Cálculo puro de las cifras de captura (carnet y selfie) del resumen de comportamiento.
 * @business Dice cuántas fotos del carnet se tomaron, cuántas salieron del escáner del sistema y si alguna se interrumpió, sin que el analista tenga que leer la bitácora.
 * @system función pura sobre los pasos `captura_<que>` de un flujo; la usa `onboarding-behavior-summary.calculo.ts`.
 */
import type { DetalleDelResumen, PasoObservado } from './onboarding-behavior-summary.tipos.js';

/**
 * Las acciones que la app manda en `metadata.eventType` de un paso `captura_<que>`
 * (`features/bitacora/tipos.ts` en la app):
 *
 * - `abre`, `toma`, `repite`, `cancela`, `segundo_plano`: la cámara de la app, desde el principio.
 * - `escanea`: la imagen llegó del escáner de documentos DEL SISTEMA (VisionKit / ML Kit). Es una
 *   captura obtenida, igual que `toma`, pero de otra población de imágenes (plan del escáner, §2).
 * - `respaldo_camara`: el escáner no estaba disponible (Expo Go, simulador, Android sin Play
 *   Services) y la app cayó a la cámara. NO es una captura: la foto, si llega, viene luego como `toma`.
 *
 * La ingesta no tiene lista cerrada de acciones (`event_type` es texto), así que las dos nuevas ya
 * se guardaban; lo que faltaba era contarlas.
 */
const TOMA_CON_CAMARA = 'toma';
const TOMA_CON_ESCANER = 'escanea';
const RESPALDO_DE_CAMARA = 'respaldo_camara';

type CifrasDeCaptura = Pick<
  DetalleDelResumen,
  'segundoPlanoDuranteCaptura' | 'capturasRepetidas' | 'capturasTomadas' | 'capturasEscaneadas' | 'respaldosDeCamara'
>;

export function esPasoDeCaptura(paso: PasoObservado): boolean {
  return paso.stepCode.startsWith('captura_');
}

/**
 * Las cifras de captura de un flujo.
 *
 * `segundoPlanoDuranteCaptura` y `capturasRepetidas` son las de siempre y se calculan igual: las dos
 * acciones nuevas no las alteran (un `escanea` no es un `repite` ni un `segundo_plano`).
 */
export function medirCapturas(pasos: PasoObservado[]): CifrasDeCaptura {
  const capturas = pasos.filter(esPasoDeCaptura);
  const cuantas = (accion: string) => capturas.filter((p) => p.eventType === accion).length;
  const escaneadas = cuantas(TOMA_CON_ESCANER);
  return {
    segundoPlanoDuranteCaptura: capturas.some((p) => p.eventType === 'segundo_plano'),
    capturasRepetidas: cuantas('repite'),
    capturasTomadas: cuantas(TOMA_CON_CAMARA) + escaneadas,
    capturasEscaneadas: escaneadas,
    respaldosDeCamara: cuantas(RESPALDO_DE_CAMARA),
  };
}
