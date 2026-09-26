/**
 * @file Tipos y constantes del resumen de comportamiento de un alta.
 * @business Convierte la bitácora de toques y tiempos del alta en cifras con las que el Motor y el analista distinguen a una persona de un guion.
 * @system contratos de entrada y salida del cálculo puro (`onboarding-behavior-summary.calculo.ts`) y los pesos de la heurística v1.
 */

export const VERSION_DEL_CALCULO = 'behavior-summary-v1';

export type PasoObservado = {
  stepCode: string;
  eventType: string;
  payload: Record<string, unknown> | null;
  occurredAt: Date;
};

export type CampoObservado = {
  fieldCode: string;
  interactionType: string;
  usedCopyPaste: boolean | null;
  correctionCount: number | null;
  focusDurationMs: number | null;
  occurredAt: Date;
};

export type ToqueObservado = {
  control: string | null;
  screenName: string | null;
  rx: number | null;
  ry: number | null;
  occurredAt: Date;
};

export type EntradasDelResumen = {
  pasos: PasoObservado[];
  campos: CampoObservado[];
  toques: ToqueObservado[];
  permisos: { granted: boolean | null }[];
  abandonosPrevios: number;
};

export type Fase = 'contacto' | 'identidad' | 'situacion' | 'habitos' | 'cierre';

export type TiempoPorPantalla = { entradas: number; totalMs: number; medianaMs: number; atras: number };

export type DetalleDelResumen = {
  segundosTotal: number | null;
  segundosEnSegundoPlano: number;
  porFaseMs: Record<Fase, number>;
  faseIdentidadMs: number;
  camposConFoco: number;
  correccionesTotales: number;
  correccionesSobreOcr: number;
  pegadosEnIdentidad: number;
  segundoPlanoDuranteCaptura: boolean;
  capturasRepetidas: number;
  /*
   * Las tres cifras del escáner del sistema (2026-09-26) son OPCIONALES a propósito: el cálculo
   * siempre las pone, pero una fila guardada antes no las tiene, y `ultimo()` devuelve el JSONB tal
   * cual. Ausente = «no se midió», nunca cero. Son aditivas: no mueven ninguna cifra ni señal de la
   * v1, por eso `VERSION_DEL_CALCULO` no cambia (el E2E de la app y el artefacto del Motor la citan).
   */
  /** Imágenes obtenidas (`toma` + `repite`), de cámara o de escáner, incluida la selfie. */
  capturasTomadas?: number;
  /** De ellas, las que devolvió el escáner del sistema (la acción anterior de esa captura fue `escanea`). */
  capturasEscaneadas?: number;
  /** Veces que el escáner no estaba y la app cayó a su cámara. */
  respaldosDeCamara?: number;
  enviosOk: number;
  enviosError: number;
  erroresDeValidacion: number;
  toques: number;
  toquesSinVariacion: boolean;
  reanudaciones: number;
  huecosEnLaBitacora: number;
  senales: string[];
};

export type ResumenCalculado = {
  completionTimeSeconds: number | null;
  interScreenTimingJson: { pantallas: Record<string, TiempoPorPantalla>; detalle: DetalleDelResumen; version: string };
  formErrorRate: number | null;
  ciCopyPasteDetected: boolean | null;
  abandonmentCountPrior: number;
  permissionGrantScore: number | null;
  botLikelihoodScore: number | null;
  computationVersion: string;
  /** `true` si hubo al menos un evento de la app: sin él, todo lo demás es `null` y no cuenta. */
  disponible: boolean;
};

/** A qué fase pertenece cada pantalla. Espejo de `features/bitacora/tipos.ts` en la app. */
export const FASE_DE_PANTALLA: Readonly<Record<string, Fase>> = {
  bienvenida: 'contacto',
  registro: 'contacto',
  'verificar-contacto': 'contacto',
  identidad: 'identidad',
  verificacion: 'identidad',
  'confirmar-datos': 'identidad',
  perfil: 'identidad',
  domicilio: 'situacion',
  economia: 'situacion',
  referencias: 'situacion',
  permisos: 'situacion',
  habitos: 'habitos',
  revision: 'cierre',
  progreso: 'cierre',
};

/** Los campos cuyo pegado dice algo sobre la identidad. Espejo de `CAMPOS_DE_IDENTIDAD` en la app. */
export const CAMPOS_DE_IDENTIDAD: ReadonlySet<string> = new Set([
  'documento_numero',
  'ocr_nombres',
  'ocr_apellidos',
  'ocr_numero',
  'ocr_nacimiento',
  'nombres',
  'apellidos',
  'nacimiento',
]);

/**
 * Pesos de la heurística v1, a la vista para que se puedan discutir.
 *
 * Es una señal de REVISIÓN, no un veredicto: el artefacto del Motor la usa sólo para escalar un
 * caso a una persona. Los cortes se revisan con los primeros cincuenta casos reales.
 */
export const PESOS = {
  sinCorreccionesConMuchosCampos: 0.35,
  toquesSinVariacion: 0.25,
  altaRelampago: 0.25,
  pegadoEnIdentidad: 0.15,
} as const;
export const MINIMO_DE_CAMPOS_PARA_SOSPECHAR = 8;
export const SEGUNDOS_DE_ALTA_RELAMPAGO = 90;
export const DESVIACION_MINIMA_DE_TOQUE = 0.02;
export const MINIMO_DE_TOQUES_POR_CONTROL = 4;

export function detalleVacio(): DetalleDelResumen {
  return {
    segundosTotal: null,
    segundosEnSegundoPlano: 0,
    porFaseMs: { contacto: 0, identidad: 0, situacion: 0, habitos: 0, cierre: 0 },
    faseIdentidadMs: 0,
    camposConFoco: 0,
    correccionesTotales: 0,
    correccionesSobreOcr: 0,
    pegadosEnIdentidad: 0,
    segundoPlanoDuranteCaptura: false,
    capturasRepetidas: 0,
    capturasTomadas: 0,
    capturasEscaneadas: 0,
    respaldosDeCamara: 0,
    enviosOk: 0,
    enviosError: 0,
    erroresDeValidacion: 0,
    toques: 0,
    toquesSinVariacion: false,
    reanudaciones: 0,
    huecosEnLaBitacora: 0,
    senales: [],
  };
}
