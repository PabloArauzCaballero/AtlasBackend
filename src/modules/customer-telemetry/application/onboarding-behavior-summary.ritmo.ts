/**
 * @file El RITMO del alta: lo que el cronómetro dice de quién teclea y toca.
 * @business Una persona es irregular —duda, corrige, tarda distinto en cada campo—; un guion es regular o imposible de
 *   rápido. Estas cifras son las que separan a uno de otro cuando las fotos y los datos son correctos.
 * @system función pura sobre los eventos que la bitácora ya guarda; no cambia `botLikelihoodScore` ni `senales` (v1).
 */
import type { CampoObservado, PasoObservado, ToqueObservado } from './onboarding-behavior-summary.tipos.js';

/** Campos que el sistema rellena de golpe (SMS, llavero): su duración no dice nada de la persona. */
const CAMPOS_DE_RELLENO_AUTOMATICO: ReadonlySet<string> = new Set(['codigo_verificacion', 'pin', 'pin_confirmacion']);

/** Por debajo de esto no se escribe un dato a mano: ni siquiera el más corto. */
export const CAMPO_INSTANTANEO_MS = 350;
/** Cuántos campos instantáneos hacen falta: uno puede ser autocompletado del teclado. */
export const MINIMO_DE_CAMPOS_INSTANTANEOS = 3;
/** Muestras mínimas para hablar de regularidad: con menos, un coeficiente bajo es casualidad. */
export const MINIMO_DE_CAMPOS_PARA_RITMO = 5;
export const MINIMO_DE_TOQUES_PARA_RITMO = 8;
/**
 * Coeficiente de variación (desviación / media) por debajo del cual el ritmo es de máquina. Una persona rellenando un
 * formulario suele pasar de 0,5; un guion con esperas fijas queda cerca de 0. El 0,15 es de partida y NO está medido
 * contra altas reales: por eso estas señales derivan a una persona y no rechazan.
 */
export const CV_DE_RITMO_MECANICO = 0.15;
/** Dos toques seguidos en menos de esto no los da un dedo recorriendo un formulario. */
export const TOQUE_SOBREHUMANO_MS = 120;
export const MINIMO_DE_TOQUES_SOBREHUMANOS = 3;
/** Abrir la cámara y disparar en menos de esto: nadie encuadra un carnet tan rápido. */
export const CAPTURA_INSTANTANEA_MS = 1_200;
/** Bolivia no tiene horario de verano: UTC−4. */
const DESPLAZAMIENTO_BOLIVIA_HORAS = -4;

export type RitmoDelAlta = {
  camposMedidos: number;
  medianaCampoMs: number | null;
  /** Coeficiente de variación de la duración de los campos; `null` con pocas muestras. */
  cvCampos: number | null;
  camposInstantaneos: number;
  intervalosDeToque: number;
  cvToques: number | null;
  toquesSobrehumanos: number;
  /** El disparo más rápido tras abrir la cámara de la app; `null` si no hubo ninguno medible. */
  capturaMasRapidaMs: number | null;
  /** Hora local (Bolivia) del primer evento del alta. */
  horaLocalDeInicio: number | null;
  senales: string[];
};

function mediana(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(orden.length / 2);
  return orden.length % 2 === 0 ? (orden[mitad - 1]! + orden[mitad]!) / 2 : orden[mitad]!;
}

/** Desviación típica sobre la media. `null` con menos muestras de las pedidas o media cero. */
export function coeficienteDeVariacion(valores: readonly number[], minimo: number): number | null {
  if (valores.length < minimo) return null;
  const media = valores.reduce((a, b) => a + b, 0) / valores.length;
  if (media <= 0) return null;
  const desviacion = Math.sqrt(valores.reduce((a, b) => a + (b - media) ** 2, 0) / valores.length);
  return Number((desviacion / media).toFixed(3));
}

/** El disparo más rápido tras `abre`, sólo con la cámara de la app: el escáner del sistema tiene sus propios tiempos. */
function capturaMasRapida(pasos: readonly PasoObservado[]): number | null {
  const abiertas = new Map<string, number>();
  let minimo: number | null = null;
  for (const paso of pasos) {
    if (!paso.stepCode.startsWith('captura_')) continue;
    if (paso.eventType === 'abre') abiertas.set(paso.stepCode, paso.occurredAt.getTime());
    else if (paso.eventType === 'escanea' || paso.eventType === 'cancela') abiertas.delete(paso.stepCode);
    else if (paso.eventType === 'toma') {
      const abierta = abiertas.get(paso.stepCode);
      if (abierta !== undefined) {
        const tardo = paso.occurredAt.getTime() - abierta;
        if (tardo >= 0 && (minimo === null || tardo < minimo)) minimo = tardo;
        abiertas.delete(paso.stepCode);
      }
    }
  }
  return minimo;
}

/**
 * Las cifras de ritmo de un alta y las señales que disparan.
 *
 * `pasos` y `toques` tienen que venir ordenados por tiempo. Señales posibles:
 * - `CAMPOS_INSTANTANEOS`: tres o más campos escritos en menos de `CAMPO_INSTANTANEO_MS` (sin contar los que el
 *   sistema rellena solo).
 * - `RITMO_UNIFORME_EN_CAMPOS` / `RITMO_UNIFORME_EN_TOQUES`: tiempos casi idénticos entre sí.
 * - `TOQUES_SOBREHUMANOS`: varios toques seguidos más rápidos de lo que da un dedo.
 * - `CAPTURA_INSTANTANEA`: cámara abierta y foto tomada sin tiempo de encuadrar.
 * - `ALTA_DE_MADRUGADA`: empezó entre la 1 y las 5 de la mañana, hora de Bolivia. Es CONTEXTO, no sospecha por sí sola.
 */
export function medirRitmo(entradas: {
  pasos: readonly PasoObservado[];
  campos: readonly CampoObservado[];
  toques: readonly ToqueObservado[];
}): RitmoDelAlta {
  const duraciones = entradas.campos
    .filter((c) => c.interactionType === 'desenfoque' && !CAMPOS_DE_RELLENO_AUTOMATICO.has(c.fieldCode))
    .map((c) => c.focusDurationMs)
    .filter((ms): ms is number => typeof ms === 'number' && Number.isFinite(ms) && ms >= 0);
  const camposInstantaneos = duraciones.filter((ms) => ms < CAMPO_INSTANTANEO_MS).length;
  const cvCampos = coeficienteDeVariacion(duraciones, MINIMO_DE_CAMPOS_PARA_RITMO);

  const instantes = entradas.toques.map((t) => t.occurredAt.getTime()).sort((a, b) => a - b);
  const intervalos = instantes.slice(1).map((t, i) => t - instantes[i]!);
  const cvToques = coeficienteDeVariacion(intervalos, MINIMO_DE_TOQUES_PARA_RITMO - 1);
  const toquesSobrehumanos = intervalos.filter((ms) => ms < TOQUE_SOBREHUMANO_MS).length;

  const captura = capturaMasRapida(entradas.pasos);
  const marcas = [...entradas.pasos, ...entradas.campos, ...entradas.toques].map((e) => e.occurredAt.getTime());
  const horaLocalDeInicio =
    marcas.length === 0 ? null : (new Date(Math.min(...marcas)).getUTCHours() + 24 + DESPLAZAMIENTO_BOLIVIA_HORAS) % 24;

  const senales: string[] = [];
  if (camposInstantaneos >= MINIMO_DE_CAMPOS_INSTANTANEOS) senales.push('CAMPOS_INSTANTANEOS');
  if (cvCampos !== null && cvCampos < CV_DE_RITMO_MECANICO) senales.push('RITMO_UNIFORME_EN_CAMPOS');
  if (cvToques !== null && cvToques < CV_DE_RITMO_MECANICO) senales.push('RITMO_UNIFORME_EN_TOQUES');
  if (toquesSobrehumanos >= MINIMO_DE_TOQUES_SOBREHUMANOS) senales.push('TOQUES_SOBREHUMANOS');
  if (captura !== null && captura < CAPTURA_INSTANTANEA_MS) senales.push('CAPTURA_INSTANTANEA');
  if (horaLocalDeInicio !== null && horaLocalDeInicio >= 1 && horaLocalDeInicio < 5) senales.push('ALTA_DE_MADRUGADA');

  return {
    camposMedidos: duraciones.length,
    medianaCampoMs: mediana(duraciones),
    cvCampos,
    camposInstantaneos,
    intervalosDeToque: intervalos.length,
    cvToques,
    toquesSobrehumanos,
    capturaMasRapidaMs: captura,
    horaLocalDeInicio,
    senales,
  };
}
