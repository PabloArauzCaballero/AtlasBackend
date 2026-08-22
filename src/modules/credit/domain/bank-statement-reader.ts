/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza saca del extracto las señales que la política usa para medir capacidad de pago.
 * @system interpreta el texto del extracto sin decidir nada sobre el crédito.
 */

/**
 * Qué se pudo leer del extracto.
 *
 * `readable` es el campo más importante de este tipo y por eso está primero. Distingue «leí el
 * extracto y no había rechazos» de «no pude leer el extracto», que producen el MISMO cero y
 * significan lo contrario: el primero es un buen historial, el segundo es un archivo que no sirve.
 * Confundirlos convertiría una foto borrosa en un expediente impecable.
 */
export type BankStatementReading = {
  readable: boolean;
  nsfCount: number;
  monthlyIncome: number | null;
  monthlyExpense: number | null;
  /** Los importes reconocidos, para poder auditar de dónde salieron las cifras. */
  creditsFound: number;
  debitsFound: number;
};

/**
 * Cómo llaman los bancos bolivianos a un rechazo por fondos insuficientes.
 *
 * No hay una redacción única: cada banco escribe lo suyo. La lista cubre las formas que aparecen en
 * los extractos de BNB, Mercantil Santa Cruz, BCP y Unión, más las abreviaturas del sistema
 * interbancario. Se compara sin acentos y en minúsculas porque el mismo banco alterna «devolución» y
 * «devolucion» según el canal por el que se genere el PDF.
 */
const NSF_MARKERS = [
  'fondos insuficientes',
  'saldo insuficiente',
  'sin fondos',
  'cheque devuelto',
  'devolucion por fondos',
  'rechazo por fondos',
  'debito rechazado',
  'nsf',
];

/** Cómo se etiqueta lo que ENTRA. Es lo que la política lee como ingreso observado. */
const CREDIT_MARKERS = ['abono', 'deposito', 'credito', 'haber', 'transferencia recibida', 'pago recibido'];

/** Y lo que SALE. */
const DEBIT_MARKERS = ['cargo', 'retiro', 'debito', 'debe', 'pago realizado', 'compra'];

/**
 * Cuántos importes hacen falta para creerse la lectura.
 *
 * Un PDF del que sólo se sacan dos números casi nunca es un extracto: es una carátula, un
 * comprobante suelto o un archivo del que el extractor apenas arañó texto. Tratarlo como extracto
 * completo produciría un ingreso observado ridículo que la política tomaría por verdadero, y el
 * cliente vería su línea desplomarse por haber subido el archivo equivocado.
 */
const MIN_MOVEMENTS_TO_TRUST = 6;

/** Suficiente texto como para que haya sido un documento y no un residuo de la extracción. */
const MIN_TEXT_LENGTH = 200;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Los importes de una línea, en unidades.
 *
 * Acepta las dos convenciones que conviven en Bolivia —`1.234,56` y `1,234.56`— decidiendo por cuál
 * separador aparece más a la derecha, que es el decimal en ambas. Sin esta distinción, `1.234`
 * podría leerse como mil doscientos treinta y cuatro o como uno coma dos tres cuatro, y la
 * diferencia entre las dos lecturas es el ingreso entero del cliente.
 */
function amountsIn(line: string): number[] {
  const matches = line.match(/-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|-?\d+(?:[.,]\d{1,2})?/g);
  if (!matches) return [];

  const out: number[] = [];
  for (const raw of matches) {
    const lastComma = raw.lastIndexOf(',');
    const lastDot = raw.lastIndexOf('.');
    let normalized: string;

    if (lastComma === -1 && lastDot === -1) normalized = raw;
    else if (lastComma > lastDot) normalized = raw.replace(/\./g, '').replace(',', '.');
    else normalized = raw.replace(/,/g, '');

    const value = Number(normalized);
    // Los importes de menos de una unidad son casi siempre números de página, códigos o fragmentos
    // de fecha; un movimiento bancario real no es de 0,3 bolivianos.
    if (Number.isFinite(value) && Math.abs(value) >= 1) out.push(Math.abs(value));
  }
  return out;
}

/**
 * Lee el extracto. NO decide nada sobre el crédito.
 *
 * Devuelve señales; quién las convierte en un límite es el motor de decisión, con su política
 * publicada y versionada. Esta función existe para que esas señales sean datos observados del
 * cliente y no un formulario que él mismo rellena.
 */
export function readBankStatement(text: string): BankStatementReading {
  const empty: BankStatementReading = {
    readable: false,
    nsfCount: 0,
    monthlyIncome: null,
    monthlyExpense: null,
    creditsFound: 0,
    debitsFound: 0,
  };

  if (!text || text.trim().length < MIN_TEXT_LENGTH) return empty;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let nsfCount = 0;
  let credits = 0;
  let debits = 0;
  let creditsFound = 0;
  let debitsFound = 0;

  for (const line of lines) {
    const normalized = normalize(line);
    if (NSF_MARKERS.some((marker) => normalized.includes(marker))) nsfCount += 1;

    const isCredit = CREDIT_MARKERS.some((marker) => normalized.includes(marker));
    const isDebit = DEBIT_MARKERS.some((marker) => normalized.includes(marker));
    // Una línea que parece las dos cosas no se cuenta para ninguna: es casi siempre la cabecera de
    // la tabla («Fecha | Débito | Crédito | Saldo»), y sumar sus números inventaría movimientos.
    if (isCredit === isDebit) continue;

    const amounts = amountsIn(line);
    if (!amounts.length) continue;

    // El mayor de la línea: junto al importe suelen ir el número de operación y el saldo resultante,
    // y de los tres el que interesa es el movimiento, que en un extracto es el de mayor magnitud
    // sólo cuando el saldo no aparece — por eso se toma el máximo excluyendo el último, que es el
    // saldo en la mayoría de formatos.
    const movement = amounts.length > 1 ? Math.max(...amounts.slice(0, -1)) : amounts[0]!;

    if (isCredit) {
      credits += movement;
      creditsFound += 1;
    } else {
      debits += movement;
      debitsFound += 1;
    }
  }

  const movements = creditsFound + debitsFound;
  if (movements < MIN_MOVEMENTS_TO_TRUST) {
    // Se leyó ALGO, pero no lo suficiente como para que las cifras signifiquen nada. Se devuelve
    // ilegible: es más honesto que entregar un ingreso observado construido con cuatro números
    // sueltos, que la política tomaría por el ingreso real de la persona.
    return empty;
  }

  return {
    readable: true,
    nsfCount,
    // Se redondea a dos decimales para que el número que viaja al motor sea el mismo que se guarda
    // en la revisión y el mismo que un analista ve al auditarla.
    monthlyIncome: creditsFound > 0 ? Number(credits.toFixed(2)) : null,
    monthlyExpense: debitsFound > 0 ? Number(debits.toFixed(2)) : null,
    creditsFound,
    debitsFound,
  };
}
