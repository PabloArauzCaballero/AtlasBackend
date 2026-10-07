/**
 * @file Dominio: el catálogo de insignias. Cada una es una regla sobre una medida; no lee nada de ningún sitio.
 * @business Pablo (2026-10-07): «aumentemos la variedad». Treinta y cuatro insignias en siete colecciones y cinco rangos,
 *   tres de ellas secretas y tres de colección (ganar insignias es, en sí, otra insignia). `experience.ts` mide al
 *   cliente y este archivo decide qué ha ganado.
 * @system función pura.
 */

/** Qué tan difícil es: bronce se gana en la primera semana, diamante es de quien lleva años. */
export type BadgeRank = 'bronce' | 'plata' | 'oro' | 'platino' | 'diamante';

/** La colección a la que pertenece: la pantalla las agrupa y cuenta «3 de 6 en Rachas». */
export type BadgeCategory = 'compras' | 'pagos' | 'rachas' | 'dinero' | 'estilo' | 'cuenta' | 'coleccion';

export type Badge = {
  code: string;
  label: string;
  detail: string;
  /** Nombre de icono del set de la app. */
  icon: string;
  rank: BadgeRank;
  category: BadgeCategory;
  /** Secreta: hasta ganarla la pantalla enseña sólo `hint`. La curiosidad es parte del juego. */
  secret: boolean;
  /** Una pista críptica para las secretas. */
  hint: string | null;
  earned: boolean;
  /** Avance hacia la insignia (`current` de `target`); en las que no son numéricas, 0/1 o 1/1. */
  current: number;
  target: number;
};

/** Lo que se mide del cliente: cada insignia mira UNA de estas cifras. */
export type Medidas = {
  /** Compras con su crédito activo o desembolsado alguna vez. */
  comprasHechas: number;
  /** Compras concretadas (las que cuentan para la experiencia). */
  compras: number;
  /** La mayor compra de una sola vez, en bolivianos. */
  mayorCompra: number;
  cuotasATiempo: number;
  /** Bolivianos pagados sin atraso. */
  pagadoATiempo: number;
  mejorRacha: number;
  comprasCerradas: number;
  /** Cuotas a tiempo pagadas con 3 días o más de adelanto. */
  madrugadas: number;
  /** Cuotas pagadas el día mismo del vencimiento. */
  alFilo: number;
  /** Cuotas a tiempo pagadas en domingo. */
  enDomingo: number;
  /** 1 si tras un atraso juntó tres cuotas a tiempo seguidas. */
  remontada: number;
  /** 1 si confirmó identidad, domicilio y contacto. */
  identidad: number;
  meses: number;
};

type Cifra = keyof Medidas | 'ganadas';

/** La meta de «Colección completa»: todas las demás. Se rellena al final con el tamaño real del catálogo. */
const TODAS = -1;

/**
 * El catálogo: código, nombre, descripción, icono, rango, colección, la cifra que mide y la meta; con una pista al final
 * es SECRETA. Una fila por insignia: añadir una es añadir una línea y su prueba.
 */
const CATALOGO: ReadonlyArray<readonly [string, string, string, string, BadgeRank, BadgeCategory, Cifra, number, string?]> = [
  ['primera_compra', 'Primera compra', 'Hiciste tu primera compra con Atlas.', 'comercio', 'bronce', 'compras', 'comprasHechas', 1],
  ['compras_3', 'Le agarraste el gusto', 'Tres compras con Atlas.', 'etiqueta', 'plata', 'compras', 'compras', 3],
  ['compras_10', 'Cliente de casa', 'Diez compras con Atlas.', 'hogar', 'oro', 'compras', 'compras', 10],
  ['compras_25', 'Leyenda del mostrador', 'Veinticinco compras con Atlas.', 'corona', 'diamante', 'compras', 'compras', 25],
  ['compra_grande', 'Compra de peso', 'Una sola compra de 500 Bs o más.', 'medalla', 'plata', 'compras', 'mayorCompra', 500],
  ['compra_gigante', 'Pesos pesados', 'Una sola compra de 2.000 Bs o más.', 'diamante', 'platino', 'compras', 'mayorCompra', 2000],
  ['primer_pago', 'Primer pago a tiempo', 'Pagaste una cuota sin atraso.', 'check', 'bronce', 'pagos', 'cuotasATiempo', 1],
  ['pagos_10', 'Diez cuotas puntuales', 'Diez cuotas pagadas sin atraso.', 'reloj', 'plata', 'pagos', 'cuotasATiempo', 10],
  ['pagos_25', 'Reloj suizo', 'Veinticinco cuotas pagadas sin atraso.', 'reloj', 'oro', 'pagos', 'cuotasATiempo', 25],
  ['pagos_50', 'Puntualidad de leyenda', 'Cincuenta cuotas pagadas sin atraso.', 'corona', 'diamante', 'pagos', 'cuotasATiempo', 50],
  ['racha_3', 'Racha de 3', 'Tres cuotas seguidas a tiempo.', 'fuego', 'plata', 'rachas', 'mejorRacha', 3],
  ['racha_6', 'Racha de 6', 'Seis cuotas seguidas a tiempo.', 'fuego', 'oro', 'rachas', 'mejorRacha', 6],
  ['racha_12', 'Racha de 12', 'Doce cuotas seguidas a tiempo.', 'rayo', 'platino', 'rachas', 'mejorRacha', 12],
  ['racha_24', 'Imparable', 'Veinticuatro cuotas seguidas a tiempo.', 'rayo', 'diamante', 'rachas', 'mejorRacha', 24],
  ['cien_bs', '100 Bs a tiempo', 'Pagaste 100 Bs sin atrasos.', 'billetera', 'plata', 'dinero', 'pagadoATiempo', 100],
  ['mil_bs', '1.000 Bs a tiempo', 'Pagaste 1.000 Bs sin atrasos.', 'billetera', 'oro', 'dinero', 'pagadoATiempo', 1000],
  ['cinco_mil_bs', '5.000 Bs a tiempo', 'Pagaste 5.000 Bs sin atrasos.', 'estrella', 'platino', 'dinero', 'pagadoATiempo', 5000],
  ['veinte_mil_bs', '20.000 Bs a tiempo', 'Pagaste 20.000 Bs sin atrasos.', 'diamante', 'diamante', 'dinero', 'pagadoATiempo', 20000],
  ['compra_cerrada', 'Compra cerrada', 'Terminaste de pagar una compra completa.', 'escudo', 'plata', 'pagos', 'comprasCerradas', 1],
  ['cerradas_3', 'Saldador serial', 'Terminaste de pagar tres compras.', 'escudo', 'oro', 'pagos', 'comprasCerradas', 3],
  ['madrugador', 'Madrugador', 'Pagaste una cuota con 3 días o más de adelanto.', 'sol', 'bronce', 'estilo', 'madrugadas', 1],
  ['madrugador_5', 'Siempre adelantado', 'Cinco cuotas pagadas con 3 días o más de adelanto.', 'cohete', 'oro', 'estilo', 'madrugadas', 5],
  [
    'al_filo',
    'Al filo',
    'Pagaste una cuota justo el día de su vencimiento.',
    'reloj',
    'bronce',
    'estilo',
    'alFilo',
    1,
    'Hay quien paga el último día y llega justo.',
  ],
  [
    'domingo',
    'Pago de domingo',
    'Pagaste una cuota a tiempo un domingo.',
    'luna',
    'bronce',
    'estilo',
    'enDomingo',
    1,
    'Ni el día de descanso te frena.',
  ],
  [
    'remontada',
    'La remontada',
    'Tras un atraso, juntaste tres cuotas seguidas a tiempo.',
    'tendencia',
    'plata',
    'estilo',
    'remontada',
    1,
    'Tropezar no es el final.',
  ],
  ['identidad', 'Identidad verificada', 'Confirmaste tu identidad, domicilio y contacto.', 'perfil', 'bronce', 'cuenta', 'identidad', 1],
  ['mes_1', 'Primer mes', 'Llevas un mes con Atlas.', 'chispa', 'bronce', 'cuenta', 'meses', 1],
  ['mes_3', 'Tres meses', 'Llevas tres meses con Atlas.', 'chispa', 'plata', 'cuenta', 'meses', 3],
  ['mes_6', 'Medio año', 'Llevas seis meses con Atlas.', 'luna', 'plata', 'cuenta', 'meses', 6],
  ['un_ano', 'Un año con Atlas', 'Llevas doce meses con nosotros.', 'reloj', 'oro', 'cuenta', 'meses', 12],
  ['dos_anos', 'Dos años contigo', 'Llevas veinticuatro meses con nosotros.', 'corona', 'platino', 'cuenta', 'meses', 24],
  ['coleccionista_10', 'Coleccionista', 'Ganaste diez insignias.', 'estrella', 'plata', 'coleccion', 'ganadas', 10],
  ['coleccionista_20', 'Vitrina llena', 'Ganaste veinte insignias.', 'medalla', 'oro', 'coleccion', 'ganadas', 20],
  ['coleccionista_total', 'Colección completa', 'Ganaste todas las demás insignias.', 'corona', 'diamante', 'coleccion', 'ganadas', TODAS],
];

export function buildBadges(m: Medidas): Badge[] {
  const construir = (fila: (typeof CATALOGO)[number], cifras: Record<Cifra, number>, meta: number): Badge => {
    const [code, label, detail, icon, rank, category, cifra, , hint] = fila;
    const current = Math.floor(cifras[cifra]);
    return {
      code,
      label,
      detail,
      icon,
      rank,
      category,
      secret: hint !== undefined,
      hint: hint ?? null,
      earned: current >= meta,
      current: Math.min(current, meta),
      target: meta,
    };
  };
  // Las de colección cuentan las demás, no a sí mismas: primero las individuales, luego las que miran cuántas hay ganadas.
  const individuales = CATALOGO.filter((f) => f[6] !== 'ganadas').map((f) => construir(f, { ...m, ganadas: 0 }, f[7]));
  const ganadas = individuales.filter((b) => b.earned).length;
  const coleccion = CATALOGO.filter((f) => f[6] === 'ganadas').map((f) =>
    construir(f, { ...m, ganadas }, f[7] === TODAS ? individuales.length : f[7]),
  );
  return [...individuales, ...coleccion];
}
