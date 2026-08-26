/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza convierte el rechazo técnico de un extracto en algo que la persona pueda resolver.
 * @system traduce los códigos del worker de extractos del motor a un motivo y un mensaje accionables.
 */

/**
 * Por qué no se pudo usar el extracto, dicho de forma que se pueda arreglar.
 *
 * ## El defecto que corrige
 *
 * Antes había UN motivo —`STATEMENT_NOT_READABLE`— y un mensaje: «Revisa que el archivo sea el
 * extracto completo y vuelve a subirlo». Con él, la persona que subió la factura de la luz, la que
 * subió un PDF que había abierto y vuelto a guardar, y la que subió un mes en vez de tres recibían
 * exactamente la misma frase. Ninguna de las tres podía saber qué hacer, así que las tres volvían a
 * subir el mismo archivo hasta rendirse.
 *
 * El motor SÍ distingue los casos —tiene tres compuertas de admisión y una política de meses— y lo
 * único que faltaba era que el mensaje lo dijera.
 *
 * ## Qué se dice y qué NO
 *
 * Se dice la acción. No se dice el detalle técnico: contarle a quien manipuló un extracto qué señal
 * exacta lo delató es enseñarle qué evitar la próxima vez, y a un cliente honesto no le sirve de
 * nada. El detalle queda en la fila —`engine_error_code`— para quien audite.
 */

/** Categorías con las que se MIDE. Una por acción distinta del cliente. */
export type RejectionCategory =
  /** No es un extracto bancario: hay que subir otro documento. */
  | 'NO_ES_EXTRACTO'
  /** Es de una entidad que no es un banco boliviano supervisado. */
  | 'EMISOR_NO_RECONOCIDO'
  /** El archivo no es el que emitió el banco: hay que subir el mismo, sin editar. */
  | 'DOCUMENTO_MANIPULADO'
  /** Cubre menos meses de los que se exigen: hay que pedir el periodo completo. */
  | 'PERIODO_INSUFICIENTE'
  /** El archivo no se puede abrir o leer. */
  | 'ARCHIVO_ILEGIBLE'
  /** Se leyó y no se pudo confiar en lo leído. */
  | 'LECTURA_INSUFICIENTE';

export interface RejectionCopy {
  readonly category: RejectionCategory;
  readonly title: string;
  readonly message: string;
}

/**
 * Del código del motor a lo que se le dice a la persona.
 *
 * Cada entrada existe porque su ACCIÓN es distinta. Dos códigos que se resuelven con lo mismo
 * comparten copia a propósito: multiplicar mensajes que dicen lo mismo con otras palabras no ayuda a
 * nadie y hace imposible medir cuál pesa.
 */
const BY_CODE: Readonly<Record<string, RejectionCopy>> = {
  NOT_A_FINANCIAL_STATEMENT: {
    category: 'NO_ES_EXTRACTO',
    title: 'Ese archivo no es un extracto bancario',
    message:
      'El documento que subiste no tiene la forma de un estado de cuenta. Entra a tu banca por internet y descarga el extracto de tu cuenta de los últimos 3 meses.',
  },
  NON_BANKING_ISSUER: {
    category: 'EMISOR_NO_RECONOCIDO',
    title: 'Ese estado de cuenta no es de un banco',
    message:
      'Es un estado de cuenta, pero lo emitió una empresa que no es una entidad financiera supervisada por ASFI. Necesitamos el extracto de tu cuenta bancaria.',
  },
  UNRECOGNIZED_ISSUER: {
    category: 'EMISOR_NO_RECONOCIDO',
    title: 'No pudimos identificar el banco',
    message:
      'La carátula del documento no identifica a ninguna entidad financiera boliviana. Sube el extracto tal como lo descargas de tu banca por internet, con su encabezado completo.',
  },
  TAMPERED_DOCUMENT: {
    category: 'DOCUMENTO_MANIPULADO',
    title: 'Ese PDF no es el original de tu banco',
    message:
      'El archivo fue compuesto o editado con otro programa, así que no podemos usarlo como evidencia. Descarga el extracto de tu banca por internet y súbelo sin abrirlo ni volver a guardarlo.',
  },
  ACTIVE_CONTENT_IN_DOCUMENT: {
    category: 'DOCUMENTO_MANIPULADO',
    title: 'Ese PDF trae contenido que no podemos abrir',
    message: 'El archivo contiene elementos ejecutables. Descarga otra vez el extracto desde tu banca por internet y súbelo tal cual.',
  },
  INSUFFICIENT_STATEMENT_PERIOD: {
    category: 'PERIODO_INSUFICIENTE',
    title: 'Necesitamos 3 meses completos',
    message:
      'Tu extracto es válido, pero cubre menos de 3 meses completos. Con menos tiempo, un ingreso extraordinario o un gasto puntual bastan para desviar el cálculo. En tu banca por internet elige el periodo de los últimos 3 meses y vuelve a subirlo.',
  },
  ENCRYPTED_PDF: {
    category: 'ARCHIVO_ILEGIBLE',
    title: 'El PDF pide contraseña',
    message: 'No podemos abrir un archivo protegido. Descarga el extracto sin contraseña, o quítasela antes de subirlo.',
  },
  PDF_EXTRACTION_FAILED: {
    category: 'ARCHIVO_ILEGIBLE',
    title: 'No pudimos abrir el archivo',
    message: 'El PDF llegó dañado o incompleto. Vuelve a descargarlo de tu banca por internet y súbelo otra vez.',
  },
  INVALID_PDF: {
    category: 'ARCHIVO_ILEGIBLE',
    title: 'El archivo no es un PDF válido',
    message: 'Sube el extracto en PDF, tal como te lo entrega tu banco.',
  },
  EMPTY_DOCUMENT: {
    category: 'ARCHIVO_ILEGIBLE',
    title: 'El PDF llegó vacío',
    message: 'El archivo no tiene páginas. Vuelve a descargarlo y súbelo otra vez.',
  },
  EMPTY_FILE: {
    category: 'ARCHIVO_ILEGIBLE',
    title: 'El archivo llegó vacío',
    message: 'La subida no completó. Inténtalo de nuevo con una conexión estable.',
  },
  FILE_TOO_LARGE: {
    category: 'ARCHIVO_ILEGIBLE',
    title: 'El archivo pesa demasiado',
    message: 'El extracto debe ser un PDF de menos de 10 MB. Descárgalo otra vez sin adjuntos.',
  },
  PDF_TOO_COMPLEX: {
    category: 'ARCHIVO_ILEGIBLE',
    title: 'El PDF tiene demasiadas páginas',
    message: 'Sube el extracto de los últimos 3 meses, no el histórico completo de la cuenta.',
  },
};

/**
 * El motivo de un rechazo, con su mensaje.
 *
 * Un código que no esté en la tabla NO se esconde ni se inventa: cae en «lectura insuficiente», que
 * es la afirmación más débil de las seis. Equivocarse hacia la más débil es lo correcto cuando falta
 * información — decirle a alguien que su documento está manipulado sin estar seguro es una acusación.
 */
export function rejectionCopyFor(code: string | null): RejectionCopy {
  if (code && BY_CODE[code]) return BY_CODE[code];
  return {
    category: 'LECTURA_INSUFICIENTE',
    title: 'No pudimos usar ese extracto',
    message:
      'Leímos el archivo y no pudimos extraer movimientos suficientes para calcular tu capacidad de pago. Sube el extracto completo de los últimos 3 meses, tal como lo descargas de tu banca por internet.',
  };
}

/**
 * Qué se le dice a quien tiene el extracto en revisión humana.
 *
 * Es un estado distinto del rechazo y merece decirse distinto: el documento sirve, y lo que falta es
 * que una persona lo mire. Callarlo haría que la espera pareciera un fallo.
 */
export function reviewCopyFor(reason: string | null): { title: string; message: string } {
  if (reason === 'SUSPECTED_TAMPERING') {
    return {
      title: 'Tu extracto está en revisión',
      message:
        'El archivo tiene indicios de haberse modificado después de emitirse y lo está mirando una persona. Si puedes, vuelve a descargarlo de tu banca por internet y súbelo sin abrirlo: eso lo resuelve más rápido.',
    };
  }
  if (reason === 'UNKNOWN_BANK') {
    return {
      title: 'Tu extracto está en revisión',
      message:
        'Reconocimos tu banco pero todavía no leemos automáticamente su formato. Una persona lo está revisando; no necesitas hacer nada.',
    };
  }
  return {
    title: 'Tu extracto está en revisión',
    message: 'Una persona está revisando tu extracto porque quedaron dudas que el sistema no pudo resolver solo. No necesitas hacer nada.',
  };
}
