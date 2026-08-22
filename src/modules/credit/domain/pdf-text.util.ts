/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza convierte el extracto que sube el cliente en texto legible por el sistema.
 * @system extrae el texto de un PDF sin dependencias externas y sin ejecutar nada del archivo.
 */
import { inflateRawSync, inflateSync, unzipSync } from 'node:zlib';

/**
 * Texto plano de un PDF.
 *
 * ## Por qué está escrito aquí y no resuelto con una librería
 *
 * Porque el archivo lo sube un desconocido. Un extracto bancario es un PDF de origen ajeno que va a
 * atravesar el backend, y las librerías de PDF de propósito general traen intérpretes de fuentes, de
 * imágenes y de JavaScript embebido: superficie de ataque entera para lo único que hace falta aquí,
 * que es leer las cadenas de texto de la página. Esta función NO interpreta el PDF: recorre sus
 * flujos, los descomprime y saca los literales de los operadores de texto. No ejecuta nada que venga
 * dentro del archivo.
 *
 * ## Qué NO hace
 *
 * No reconoce texto en imágenes. Un extracto escaneado —una foto de un papel— no tiene cadenas que
 * sacar y esta función devuelve vacío. Es un límite real y hay que tratarlo como tal: quien llama
 * debe distinguir «leí el extracto y no había rechazos» de «no pude leer el extracto», porque
 * confundirlos convierte un archivo ilegible en un expediente impecable.
 */
export function extractPdfText(buffer: Buffer): string {
  const chunks: string[] = [];

  // Los flujos van entre `stream`/`endstream`. Se recorren en binario porque el contenido comprimido
  // no es texto y partirlo por líneas lo corrompería.
  let cursor = 0;
  while (cursor < buffer.length) {
    const start = buffer.indexOf('stream', cursor, 'latin1');
    if (start === -1) break;
    const end = buffer.indexOf('endstream', start, 'latin1');
    if (end === -1) break;

    // Tras `stream` viene un salto de línea (CRLF o LF) antes de los datos.
    let from = start + 'stream'.length;
    if (buffer[from] === 0x0d) from += 1;
    if (buffer[from] === 0x0a) from += 1;

    const text = decodeStream(buffer.subarray(from, end));
    if (text) chunks.push(text);
    cursor = end + 'endstream'.length;
  }

  return chunks.map(readTextOperators).filter(Boolean).join('\n');
}

/**
 * Descomprime un flujo si puede, y si no lo devuelve tal cual.
 *
 * Casi todos los PDF usan `FlateDecode`, pero no todos, y el diccionario que lo declara puede vivir
 * en un objeto indirecto que habría que resolver. Probar a descomprimir y aceptar el fallo cuesta
 * menos y falla mejor: un flujo que no es zlib simplemente se lee como estaba.
 */
function decodeStream(raw: Buffer): string | null {
  if (raw.length === 0) return null;
  for (const attempt of [inflateSync, unzipSync, inflateRawSync]) {
    try {
      return attempt(raw).toString('latin1');
    } catch {
      // Siguiente estrategia.
    }
  }
  // Un flujo sin comprimir se lee directamente; uno de imagen no produce operadores de texto y se
  // descarta solo en el paso siguiente.
  return raw.toString('latin1');
}

/**
 * Saca las cadenas de los operadores de texto.
 *
 * El resto del flujo son coordenadas y ajustes de fuente que no dicen nada. Se conserva el orden de
 * aparición, que en la práctica es el orden de lectura de la página.
 */
function readTextOperators(content: string): string {
  const matches = content.match(/\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>/g);
  if (!matches) return '';

  const out: string[] = [];
  for (const match of matches) {
    if (match.startsWith('<')) out.push(decodeHexString(match.slice(1, -1)));
    else out.push(unescapePdfLiteral(match.slice(1, -1)));
  }
  return out.join('');
}

function unescapePdfLiteral(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\([0-7]{1,3})/g, (_, code: string) => String.fromCharCode(parseInt(code, 8)))
    .replace(/\\(.)/g, '$1');
}

/** Cadenas hexadecimales (`<48656C6C6F>`), que algunos generadores usan en lugar de literales. */
function decodeHexString(value: string): string {
  const digits = value.replace(/\s+/g, '');
  let out = '';
  for (let index = 0; index + 1 < digits.length; index += 2) {
    const code = parseInt(digits.slice(index, index + 2), 16);
    if (Number.isFinite(code) && code >= 32) out += String.fromCharCode(code);
  }
  return out;
}
