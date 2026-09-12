/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { base64Url } from '../../../../common/utils/crypto/encoding.util.js';

const CRLF = '\r\n';

/**
 * RFC 2047: un `encoded-word` completo no puede pasar de 75 caracteres. `=?UTF-8?B?` + `?=` gastan
 * 12, así que al payload base64 le quedan 63; 45 bytes es el múltiplo de 3 más grande que cabe
 * (ceil(45/3)*4 = 60). Cortar en múltiplo de 3 evita además padding `=` a mitad de cabecera.
 */
const HEADER_CHUNK_BYTES = 45;
/** RFC 2045: las líneas de un cuerpo base64 no deben exceder 76 caracteres. */
const BASE64_LINE_LENGTH = 76;

/**
 * Deliberadamente conservadora: no pretende cubrir todo RFC 5322, sino rechazar cualquier cosa que
 * pueda romper la estructura de cabeceras (CR/LF, comas que inventarían destinatarios extra,
 * ángulos que cerrarían un `<addr-spec>` ajeno). El origen de estas direcciones es el payload de la
 * notificación, así que se trata como entrada no confiable.
 */
const ADDRESS_PATTERN = /^[^\s@,<>"();:\\[\]]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export type GmailMimeInput = {
  from: string;
  /** Nombre visible del remitente. Sin el, el cliente ve una direccion suelta y desconfia. */
  fromName?: string | null;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string | null;
  subject: string;
  text: string;
  html?: string | null;
  /**
   * Semilla del boundary MIME. Se usa el id del mensaje para que el `raw` sea reproducible: un
   * boundary aleatorio haría imposible asertar sobre el correo generado en las pruebas.
   */
  boundarySeed: string;
};

export function isValidEmailAddress(value: string): boolean {
  return value.length <= 254 && ADDRESS_PATTERN.test(value);
}

/** Corta por code points (nunca por unidad UTF-16) para no partir un carácter multibyte a la mitad. */
function splitByUtf8Bytes(value: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > maxBytes && current.length > 0) {
      chunks.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Codifica un valor de cabecera. Dos responsabilidades inseparables:
 * 1. **Anti header-injection**: un `\r\n` en un asunto controlado por el payload permitiría añadir
 *    cabeceras arbitrarias (un `Bcc:` a un tercero, por ejemplo). Se colapsa a espacio, no se
 *    escapa.
 * 2. **RFC 2047**: las cabeceras solo admiten ASCII; con acentos —normales en español— se emite
 *    `=?UTF-8?B?...?=` plegado en varios `encoded-word` si hace falta.
 */
export function encodeHeaderValue(raw: string): string {
  const value = raw.replace(/[\r\n]+/g, ' ').trim();
  if (!/[^\x20-\x7E]/.test(value)) return value;
  return splitByUtf8Bytes(value, HEADER_CHUNK_BYTES)
    .map((chunk) => `=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`)
    .join(`${CRLF} `);
}

function base64Body(value: string): string {
  const encoded = Buffer.from(value, 'utf8').toString('base64');
  return (encoded.match(new RegExp(`.{1,${BASE64_LINE_LENGTH}}`, 'g')) ?? ['']).join(CRLF);
}

/**
 * Los caracteres válidos de un boundary son un subconjunto de ASCII y su longitud máxima es 70. Al
 * codificar ambas partes en base64 (alfabeto sin `-`) y al exigir RFC 2046 que un delimitador
 * empiece en columna 0 con `--`, el boundary no puede colisionar con el contenido.
 */
function boundaryFrom(seed: string): string {
  const normalized = seed.replace(/[^A-Za-z0-9]/g, '').slice(0, 48);
  return `atlas-${normalized.length > 0 ? normalized : 'boundary'}`;
}

function addressHeader(name: string, addresses: string[] | undefined): string[] {
  const list = (addresses ?? []).filter((address) => address.trim().length > 0);
  return list.length > 0 ? [`${name}: ${list.join(', ')}`] : [];
}

function bodyLines(input: GmailMimeInput): string[] {
  const html = input.html?.trim();
  if (!html) {
    return ['Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', base64Body(input.text)];
  }
  const boundary = boundaryFrom(input.boundarySeed);
  return [
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(input.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(html),
    `--${boundary}--`,
  ];
}

/**
 * Construye el mensaje RFC 5322 completo y lo devuelve en base64url, que es exactamente lo que el
 * campo `raw` de `gmail.users.messages.send` espera.
 *
 * `Date` y `Message-ID` se omiten a propósito: Gmail los asigna al aceptar el envío, y generarlos
 * aquí solo introduciría no-determinismo en las pruebas sin aportar nada.
 */
export function buildGmailRawMessage(input: GmailMimeInput): string {
  const headers = [
    /*
      `Nombre <correo>` cuando hay nombre.

      El nombre se codifica igual que cualquier otra cabecera —puede llevar acentos— y la direccion
      va entre angulos SIN codificar: un `<...>` codificado deja de ser una direccion para el
      servidor de correo y el envio falla con un error que no menciona la cabecera.
    */
    `From: ${input.fromName ? `${encodeHeaderValue(input.fromName)} <${input.from}>` : encodeHeaderValue(input.from)}`,
    ...addressHeader('To', input.to),
    ...addressHeader('Cc', input.cc),
    ...addressHeader('Bcc', input.bcc),
    ...(input.replyTo ? [`Reply-To: ${encodeHeaderValue(input.replyTo)}`] : []),
    `Subject: ${encodeHeaderValue(input.subject)}`,
    'MIME-Version: 1.0',
  ];
  return base64Url([...headers, ...bodyLines(input)].join(CRLF));
}
