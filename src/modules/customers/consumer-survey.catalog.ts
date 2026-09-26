/**
 * @file El catálogo de la encuesta de hábitos: preguntas, opciones y versión.
 * @business Preguntas de SITUACIÓN declarada, no de personalidad: lo que puntúa después es la consistencia con lo observado.
 * @system versión `habitos-v1`; la app pinta lo que este catálogo devuelve y el servidor valida contra él.
 *   Vive en `customers` porque la regla de elegibilidad (que decide si la sección está completa) no puede
 *   depender de `customer-onboarding`; el módulo de alta lo reexporta.
 */

export const VERSION_DE_ENCUESTA = 'habitos-v1';

export type TipoDePregunta = 'opcion' | 'monto';

export type PreguntaDeHabitos = {
  code: string;
  /** La pregunta tal como se lee en pantalla. */
  prompt: string;
  /** Con qué se cruza. Se enseña al analista, no al cliente. */
  crossCheck: string;
  type: TipoDePregunta;
  options?: { code: string; label: string }[];
  /** Para `monto`: rango admitido en Bs. */
  min?: number;
  max?: number;
};

/*
 * Por qué estas seis y no «¿qué tan cierto es que priorizo pagar?»: en un contexto de alta apuesta
 * una escala de acuerdo se contesta «totalmente cierto» y no separa a nadie (LenddoEFL, 2018). Una
 * pregunta de situación tiene una respuesta CONTRASTABLE —contra el ingreso declarado, contra el
 * extracto, contra el número de dependientes que ya dijo en la fase 3— y mentir en ella obliga a
 * mentir en dos sitios a la vez.
 */
export const PREGUNTAS_DE_HABITOS: readonly PreguntaDeHabitos[] = [
  {
    code: 'gasto_fijo',
    prompt: 'De lo que ganas al mes, ¿cuánto se va en gastos fijos (alquiler, servicios, comida)?',
    crossCheck: 'Ingreso y gastos declarados en la fase 3; extracto si lo hay.',
    type: 'opcion',
    options: [
      { code: 'menos_25', label: 'Menos de la cuarta parte' },
      { code: '25_50', label: 'Entre la cuarta parte y la mitad' },
      { code: '50_75', label: 'Entre la mitad y tres cuartos' },
      { code: 'mas_75', label: 'Casi todo' },
    ],
  },
  {
    code: 'dependientes',
    prompt: '¿Cuántas personas dependen de tus ingresos?',
    crossCheck: 'Dependientes declarados en el perfil económico: deben coincidir.',
    type: 'opcion',
    options: [
      { code: '0', label: 'Ninguna' },
      { code: '1', label: 'Una' },
      { code: '2', label: 'Dos' },
      { code: '3_mas', label: 'Tres o más' },
    ],
  },
  {
    code: 'ahorro',
    prompt: 'Cuando te sobra dinero a fin de mes, ¿qué haces?',
    crossCheck: 'Saldo medio del extracto.',
    type: 'opcion',
    options: [
      { code: 'ahorro', label: 'Lo guardo' },
      { code: 'pago_deudas', label: 'Pago deudas' },
      { code: 'compro', label: 'Compro algo que quería' },
      { code: 'no_sobra', label: 'No me sobra' },
    ],
  },
  {
    code: 'imprevisto',
    prompt: 'Si mañana necesitas Bs 500 que no tenías, ¿de dónde salen?',
    crossCheck: 'Consistencia con «ahorro»: quien guarda tiene de dónde sacar.',
    type: 'opcion',
    options: [
      { code: 'ahorros', label: 'De mis ahorros' },
      { code: 'familia', label: 'Me los presta alguien de confianza' },
      { code: 'prestamo', label: 'Pido un préstamo' },
      { code: 'no_sabria', label: 'No sabría de dónde' },
    ],
  },
  {
    code: 'cuota_maxima',
    prompt: '¿Cuál es la cuota máxima que podrías pagar cada mes sin apuros?',
    crossCheck: 'Contra el ingreso declarado: una cuota mayor al 40 % del ingreso es una bandera.',
    type: 'monto',
    min: 20,
    max: 50_000,
  },
  {
    code: 'frecuencia',
    prompt: '¿Cada cuánto prefieres pagar tus cuotas?',
    crossCheck: 'Producto: define el calendario que se ofrece.',
    type: 'opcion',
    options: [
      { code: 'quincenal', label: 'Cada quince días' },
      { code: 'mensual', label: 'Cada mes' },
    ],
  },
];

export const CODIGOS_DE_PREGUNTA: readonly string[] = PREGUNTAS_DE_HABITOS.map((p) => p.code);

/** Por debajo de esto la persona no leyó la pregunta. Se anota como señal, no se rechaza la respuesta. */
export const MS_MINIMOS_PARA_LEER = 1_500;
