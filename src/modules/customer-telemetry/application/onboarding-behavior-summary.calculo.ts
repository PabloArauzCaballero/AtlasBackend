/**
 * @file Cálculo puro del resumen de comportamiento de un alta.
 * @business Convierte la bitácora de toques y tiempos del alta en las cifras con las que el Motor y el analista distinguen a una persona de un guion.
 * @system función pura sobre los eventos de un flujo: sin base, sin reloj propio, reproducible. Los tipos y pesos viven en `…tipos.ts`.
 */
import {
  CAMPOS_DE_IDENTIDAD,
  DESVIACION_MINIMA_DE_TOQUE,
  FASE_DE_PANTALLA,
  MINIMO_DE_CAMPOS_PARA_SOSPECHAR,
  MINIMO_DE_TOQUES_POR_CONTROL,
  PESOS,
  SEGUNDOS_DE_ALTA_RELAMPAGO,
  VERSION_DEL_CALCULO,
  detalleVacio,
  type CampoObservado,
  type DetalleDelResumen,
  type EntradasDelResumen,
  type Fase,
  type PasoObservado,
  type ResumenCalculado,
  type TiempoPorPantalla,
  type ToqueObservado,
} from './onboarding-behavior-summary.tipos.js';

export * from './onboarding-behavior-summary.tipos.js';

/*
 * ## Qué entra
 *
 * Los eventos de UN flujo de alta tal como los guardó la ingesta (`customer-telemetry.service.ts`):
 * pasos (`onboarding_step_events`), campos (`form_field_interaction_events`), toques
 * (`customer_actions` con `event_name = 'tap'`) y permisos. Y cuántos flujos anteriores del mismo
 * cliente quedaron abandonados.
 *
 * ## Qué sale
 *
 * Las columnas de `onboarding_behavior_summaries` calculadas de verdad, más un `detalle` que se
 * guarda dentro de `inter_screen_timing_json` para que el analista vea de dónde salió cada cifra.
 *
 * ## Qué NO es
 *
 * Un veredicto. `botLikelihoodScore` es una heurística versionada cuyos pesos están a la vista en
 * `…tipos.ts`; el artefacto del Motor la usa sólo para ESCALAR un caso a revisión humana, nunca para
 * rechazar. Y un flujo sin eventos produce `null`, no cero: «no se midió» y «midió cero» son dos
 * hechos distintos y el segundo sería inventado.
 */

function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 === 0 ? Math.round((orden[medio - 1]! + orden[medio]!) / 2) : orden[medio]!;
}

function numero(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

function desviacion(valores: number[]): number {
  if (valores.length === 0) return 0;
  const media = valores.reduce((a, b) => a + b, 0) / valores.length;
  return Math.sqrt(valores.reduce((a, b) => a + (b - media) ** 2, 0) / valores.length);
}

/** Milisegundos en segundo plano: cada `segundo_plano` cerrado por el siguiente `primer_plano`. */
function segundoPlanoMs(pasos: PasoObservado[]): number {
  let total = 0;
  let abierto: number | null = null;
  for (const paso of pasos) {
    if (paso.stepCode !== 'flujo') continue;
    if (paso.eventType === 'segundo_plano') abierto = paso.occurredAt.getTime();
    else if (paso.eventType === 'primer_plano' && abierto !== null) {
      total += Math.max(0, paso.occurredAt.getTime() - abierto);
      abierto = null;
    }
  }
  return total;
}

/** Tiempo total del alta (descontando el segundo plano) y el detalle de esa resta. */
function medirTiempo(entradas: EntradasDelResumen, pasos: PasoObservado[]): { segundosTotal: number; enSegundoPlanoMs: number } {
  const marcas = [...pasos, ...entradas.campos, ...entradas.toques].map((e) => e.occurredAt.getTime());
  const enSegundoPlanoMs = segundoPlanoMs(pasos);
  const segundosTotal = Math.max(0, Math.round((Math.max(...marcas) - Math.min(...marcas) - enSegundoPlanoMs) / 1000));
  return { segundosTotal, enSegundoPlanoMs };
}

type Acumulado = Record<string, TiempoPorPantalla & { tramos: number[] }>;

function anotarTramo(acumulado: Acumulado, porFaseMs: Record<Fase, number>, codigo: string, fase: Fase, tramo: number): void {
  const registro = (acumulado[codigo] ??= { entradas: 0, totalMs: 0, medianaMs: 0, atras: 0, tramos: [] });
  registro.tramos.push(tramo);
  registro.totalMs += tramo;
  porFaseMs[fase] += tramo;
}

type EstadoDePantallas = {
  acumulado: Acumulado;
  porFaseMs: Record<Fase, number>;
  /** Pantallas con `enter` y todavía sin `leave`, con el reloj de la app en el que entraron. */
  abiertas: Map<string, number>;
  ultimoReloj: number | null;
};

function observarPantalla(estado: EstadoDePantallas, paso: PasoObservado, fase: Fase): void {
  const reloj = numero(paso.payload?.['elapsedMs']);
  const registro = (estado.acumulado[paso.stepCode] ??= { entradas: 0, totalMs: 0, medianaMs: 0, atras: 0, tramos: [] });
  if (paso.eventType === 'enter') {
    registro.entradas += 1;
    if (reloj !== null) estado.abiertas.set(paso.stepCode, reloj);
    return;
  }
  if (paso.eventType !== 'leave' && paso.eventType !== 'back') return;
  if (paso.eventType === 'back') registro.atras += 1;
  estado.abiertas.delete(paso.stepCode);
  const tramo = numero(paso.payload?.['sinceEnterMs']);
  if (tramo !== null) anotarTramo(estado.acumulado, estado.porFaseMs, paso.stepCode, fase, tramo);
}

/** Entradas, tiempo y «atrás» por pantalla, y el tiempo acumulado por fase. */
function medirPantallas(pasos: PasoObservado[]): { pantallas: Record<string, TiempoPorPantalla>; porFaseMs: Record<Fase, number> } {
  const estado: EstadoDePantallas = {
    acumulado: {},
    porFaseMs: { contacto: 0, identidad: 0, situacion: 0, habitos: 0, cierre: 0 },
    abiertas: new Map(),
    ultimoReloj: null,
  };
  for (const paso of pasos) {
    const reloj = numero(paso.payload?.['elapsedMs']);
    if (reloj !== null) estado.ultimoReloj = Math.max(estado.ultimoReloj ?? 0, reloj);
    const fase = FASE_DE_PANTALLA[paso.stepCode];
    if (fase) observarPantalla(estado, paso, fase);
  }
  /*
   * La pantalla que sigue abierta cuenta hasta el último reloj visto. El resumen de identidad se
   * calcula DENTRO del envío del carnet, antes de que la app mande el `leave` de esa pantalla: sin
   * esto la fase de identidad llegaba al Motor como 0 s (medido en TEST el 2026-09-18) y la regla
   * «identidad < 40 s» se cumplía para todo el mundo.
   */
  for (const [codigo, entradaMs] of estado.abiertas) {
    const tramo = (estado.ultimoReloj ?? 0) - entradaMs;
    if (tramo > 0) anotarTramo(estado.acumulado, estado.porFaseMs, codigo, FASE_DE_PANTALLA[codigo]!, tramo);
  }
  const pantallas: Record<string, TiempoPorPantalla> = {};
  for (const [codigo, r] of Object.entries(estado.acumulado)) {
    pantallas[codigo] = { entradas: r.entradas, totalMs: r.totalMs, medianaMs: mediana(r.tramos), atras: r.atras };
  }
  return { pantallas, porFaseMs: estado.porFaseMs };
}

/** Cuántos campos tuvieron foco, cuántas correcciones hubo y cuántos pegados en campos de identidad. */
function medirCampos(campos: CampoObservado[]): {
  camposConFoco: number;
  correccionesTotales: number;
  correccionesSobreOcr: number;
  pegadosEnIdentidad: number;
} {
  const correccionesDe = (c: CampoObservado) => (c.interactionType === 'desenfoque' ? (c.correctionCount ?? 0) : 0);
  return {
    camposConFoco: new Set(campos.filter((c) => c.interactionType === 'foco').map((c) => c.fieldCode)).size,
    correccionesTotales: campos.reduce((n, c) => n + correccionesDe(c), 0),
    correccionesSobreOcr: campos.reduce((n, c) => n + (c.fieldCode.startsWith('ocr_') ? correccionesDe(c) : 0), 0),
    pegadosEnIdentidad: campos.filter((c) => c.usedCopyPaste === true && CAMPOS_DE_IDENTIDAD.has(c.fieldCode)).length,
  };
}

/** Si algún control recibió ≥ 4 toques exactamente en el mismo punto: un dedo no repite coordenadas. */
function toquesSinVariacion(toques: ToqueObservado[]): boolean {
  const porControl = new Map<string, { rx: number[]; ry: number[] }>();
  for (const toque of toques) {
    if (!toque.control || toque.rx === null || toque.ry === null) continue;
    const r = porControl.get(toque.control) ?? { rx: [], ry: [] };
    r.rx.push(toque.rx);
    r.ry.push(toque.ry);
    porControl.set(toque.control, r);
  }
  return [...porControl.values()].some(
    (r) =>
      r.rx.length >= MINIMO_DE_TOQUES_POR_CONTROL &&
      desviacion(r.rx) < DESVIACION_MINIMA_DE_TOQUE &&
      desviacion(r.ry) < DESVIACION_MINIMA_DE_TOQUE,
  );
}

/** Envíos, errores y su tasa. `null` sin ningún envío: no hay de qué medir una tasa. */
function medirEnvios(pasos: PasoObservado[]): {
  enviosOk: number;
  enviosError: number;
  erroresDeValidacion: number;
  formErrorRate: number | null;
} {
  const enviosOk = pasos.filter((p) => p.eventType === 'submit_ok').length;
  const enviosError = pasos.filter((p) => p.eventType === 'submit_error').length;
  const erroresDeValidacion = pasos.filter((p) => p.eventType === 'validation_error').length;
  const formErrorRate = enviosOk + enviosError === 0 ? null : Math.min(1, (enviosError + erroresDeValidacion) / (enviosOk + enviosError));
  return { enviosOk, enviosError, erroresDeValidacion, formErrorRate };
}

/** La heurística v1: suma de pesos por señal, acotada a [0, 1], y las señales que la componen. */
function heuristica(
  d: Pick<
    DetalleDelResumen,
    'camposConFoco' | 'correccionesTotales' | 'toquesSinVariacion' | 'pegadosEnIdentidad' | 'segundoPlanoDuranteCaptura'
  > & { segundosTotal: number },
): {
  bot: number;
  senales: string[];
} {
  const senales: string[] = [];
  let bot = 0;
  if (d.camposConFoco >= MINIMO_DE_CAMPOS_PARA_SOSPECHAR && d.correccionesTotales === 0) {
    bot += PESOS.sinCorreccionesConMuchosCampos;
    senales.push('SIN_CORRECCIONES');
  }
  if (d.toquesSinVariacion) {
    bot += PESOS.toquesSinVariacion;
    senales.push('TOQUES_SIN_VARIACION');
  }
  if (d.segundosTotal < SEGUNDOS_DE_ALTA_RELAMPAGO) {
    bot += PESOS.altaRelampago;
    senales.push('ALTA_RELAMPAGO');
  }
  if (d.pegadosEnIdentidad > 0) {
    bot += PESOS.pegadoEnIdentidad;
    senales.push('PEGADO_EN_IDENTIDAD');
  }
  if (d.segundoPlanoDuranteCaptura) senales.push('CAPTURA_INTERRUMPIDA');
  return { bot: Number(Math.min(1, bot).toFixed(2)), senales };
}

function puntajeDePermisos(permisos: { granted: boolean | null }[]): number | null {
  const decididos = permisos.filter((p) => p.granted !== null);
  if (decididos.length === 0) return null;
  return Number((decididos.filter((p) => p.granted === true).length / decididos.length).toFixed(2));
}

function resumenVacio(entradas: EntradasDelResumen): ResumenCalculado {
  return {
    completionTimeSeconds: null,
    interScreenTimingJson: { pantallas: {}, detalle: detalleVacio(), version: VERSION_DEL_CALCULO },
    formErrorRate: null,
    ciCopyPasteDetected: null,
    abandonmentCountPrior: entradas.abandonosPrevios,
    permissionGrantScore: puntajeDePermisos(entradas.permisos),
    botLikelihoodScore: null,
    computationVersion: VERSION_DEL_CALCULO,
    disponible: false,
  };
}

export function calcularResumen(entradas: EntradasDelResumen): ResumenCalculado {
  const pasos = [...entradas.pasos].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  if (pasos.length + entradas.campos.length + entradas.toques.length === 0) return resumenVacio(entradas);

  const tiempo = medirTiempo(entradas, pasos);
  const { pantallas, porFaseMs } = medirPantallas(pasos);
  const campos = medirCampos(entradas.campos);
  const envios = medirEnvios(pasos);
  const esCaptura = (p: PasoObservado) => p.stepCode.startsWith('captura_');
  const segundoPlanoDuranteCaptura = pasos.some((p) => esCaptura(p) && p.eventType === 'segundo_plano');
  const sinVariacion = toquesSinVariacion(entradas.toques);
  const { bot, senales } = heuristica({
    ...campos,
    toquesSinVariacion: sinVariacion,
    segundoPlanoDuranteCaptura,
    segundosTotal: tiempo.segundosTotal,
  });

  const detalle: DetalleDelResumen = {
    segundosTotal: tiempo.segundosTotal,
    segundosEnSegundoPlano: Math.round(tiempo.enSegundoPlanoMs / 1000),
    porFaseMs,
    faseIdentidadMs: porFaseMs.identidad,
    ...campos,
    segundoPlanoDuranteCaptura,
    capturasRepetidas: pasos.filter((p) => esCaptura(p) && p.eventType === 'repite').length,
    enviosOk: envios.enviosOk,
    enviosError: envios.enviosError,
    erroresDeValidacion: envios.erroresDeValidacion,
    toques: entradas.toques.length,
    toquesSinVariacion: sinVariacion,
    reanudaciones: pasos.filter((p) => p.stepCode === 'flujo' && p.eventType === 'reanudado').length,
    huecosEnLaBitacora: pasos.filter(
      (p) => p.stepCode === 'flujo' && (p.eventType === 'cola_recortada' || p.eventType === 'lote_rechazado'),
    ).length,
    senales,
  };

  return {
    completionTimeSeconds: tiempo.segundosTotal,
    interScreenTimingJson: { pantallas, detalle, version: VERSION_DEL_CALCULO },
    formErrorRate: envios.formErrorRate === null ? null : Number(envios.formErrorRate.toFixed(4)),
    ciCopyPasteDetected: entradas.campos.length === 0 ? null : campos.pegadosEnIdentidad > 0,
    abandonmentCountPrior: entradas.abandonosPrevios,
    permissionGrantScore: puntajeDePermisos(entradas.permisos),
    botLikelihoodScore: bot,
    computationVersion: VERSION_DEL_CALCULO,
    disponible: true,
  };
}
