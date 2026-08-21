/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace que un correo transaccional de ATLAS se reconozca como de ATLAS, que es parte de que no se confunda con una suplantación.
 * @system compone el HTML de las plantillas con la identidad visual del portal y las restricciones de los clientes de correo.
 */

/**
 * El armazón visual de los correos transaccionales.
 *
 * ## Por qué no se escribe el HTML en cada plantilla
 *
 * Las cinco plantillas decían lo mismo con `<p>` sueltos: sin membrete, sin
 * marca y con el código en negrita. Un correo así es indistinguible del que
 * escribiría cualquiera, y eso importa más de lo que parece en los correos que
 * mandamos: **todos llevan un código o una contraseña**. Lo que hace que alguien
 * distinga el nuestro de una suplantación es exactamente lo que faltaba —el
 * membrete, la tipografía, el color de la marca—, así que la identidad visual no
 * es aquí un adorno sino parte del mensaje.
 *
 * Se compone desde un solo sitio porque cinco copias del mismo membrete se
 * separan a la primera vez que alguien retoca una.
 *
 * ## Las reglas del correo, que no son las de la web
 *
 * El HTML de un correo no es el del portal, y casi todo lo que se usa allá está
 * prohibido aquí:
 *
 * - **Maquetación con tablas.** Outlook (motor de Word) no implementa flexbox ni
 *   grid; una caja hecha con `display:flex` se apila en una columna sin avisar.
 * - **Estilo EN LÍNEA.** Gmail descarta el `<style>` del `<head>` en su cliente
 *   web, así que todo lo que deba verse sí o sí va como atributo `style`. El
 *   bloque `<style>` queda para lo que se puede perder sin consecuencia: la
 *   adaptación a pantalla estrecha y el modo oscuro.
 * - **Tipografía con respaldo real.** Inter se pide por `@import`, y la mayoría
 *   de clientes lo ignoran: la pila de reserva no es una formalidad, es lo que
 *   de verdad se ve en Gmail y en Outlook.
 * - **Sin imágenes.** Un membrete hecho de imagen aparece roto hasta que la
 *   persona pulsa «mostrar imágenes», que es justo lo que no hace en un correo
 *   que no reconoce todavía. El logotipo es texto.
 */

/** La identidad de ATLAS, en los valores que el portal define como tokens. */
const COLOR = {
  canvas: '#f5f5f7',
  surface: '#ffffff',
  ink: '#1d1d1f',
  text: '#38383d',
  muted: '#5a5a63',
  faint: '#6b6b75',
  line: '#e4e4e7',
  accent: '#006a61',
  accentWash: '#f0f8f7',
  accentSoft: '#d9ebe8',
  codeSurface: '#16161a',
  codeInk: '#e9e9ee',
  warning: '#a34a05',
  warningWash: '#fdf6ec',
  warningLine: '#f0d9b6',
} as const;

/**
 * Inter primero y el resto como respaldo REAL. El orden no es decorativo: en
 * Gmail y Outlook se verá la segunda o la tercera, así que la pila tiene que
 * quedar bien con cualquiera de ellas.
 */
const FONT = "'Inter','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif";
const FONT_MONO = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";

export type MailBlock = string;

/** Un párrafo del cuerpo. */
export function mailParagraph(text: string): MailBlock {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:24px;` + `color:${COLOR.text}">${text}</p>`;
}

/**
 * El código, que es lo único que la persona viene a buscar.
 *
 * Sobre fondo oscuro y en monoespaciada por la misma razón que el portal pinta
 * los bloques de código oscuros en los dos temas: un código se lee mejor
 * invertido, y separarlo del texto elimina la duda de dónde empieza y dónde
 * acaba. El interletraje ancho es lo que permite copiarlo a mano sin releer.
 */
export function mailCode(value: string): MailBlock {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="margin:8px 0 20px"><tr><td align="center" ` +
    `style="background:${COLOR.codeSurface};border-radius:12px;padding:22px 16px">` +
    `<div style="font-family:${FONT_MONO};font-size:30px;line-height:36px;font-weight:700;` +
    `letter-spacing:10px;color:${COLOR.codeInk};text-indent:10px">${value}</div>` +
    `</td></tr></table>`
  );
}

/** Un dato con su rótulo: usuario, contraseña temporal. */
export function mailField(label: string, value: string): MailBlock {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="margin:0 0 10px"><tr><td style="background:${COLOR.accentWash};` +
    `border:1px solid ${COLOR.accentSoft};border-radius:10px;padding:12px 16px">` +
    `<div style="font-family:${FONT};font-size:11px;line-height:16px;font-weight:600;` +
    `color:${COLOR.accent}">${label}</div>` +
    `<div style="font-family:${FONT_MONO};font-size:15px;line-height:22px;` +
    `color:${COLOR.ink};word-break:break-all">${value}</div></td></tr></table>`
  );
}

/**
 * El aviso de qué hacer si el correo no se esperaba.
 *
 * Va en ámbar y con borde, no en rojo: nada ha fallado todavía. El rojo en un
 * correo que quizá sea rutinario enseña a ignorar el color, y estos avisos son
 * justo los que tienen que leerse el día que sí importan.
 */
export function mailNotice(text: string): MailBlock {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="margin:20px 0 0"><tr><td style="background:${COLOR.warningWash};` +
    `border:1px solid ${COLOR.warningLine};border-radius:10px;padding:14px 16px;` +
    `font-family:${FONT};font-size:13px;line-height:20px;color:${COLOR.warning}">` +
    `${text}</td></tr></table>`
  );
}

export interface MailShellInput {
  /**
   * Lo que la bandeja enseña junto al asunto, antes de abrir. Sin él, el cliente
   * toma las primeras palabras del cuerpo —«Hola {{nombre}},»— y la lista de
   * correos queda con cinco entradas idénticas.
   */
  readonly preheader: string;
  /** Rótulo pequeño sobre el título: de qué trata el correo en dos palabras. */
  readonly eyebrow: string;
  readonly title: string;
  readonly blocks: readonly MailBlock[];
  /**
   * El producto de ATLAS que originó el correo, junto al logotipo.
   *
   * La cabecera decía SIEMPRE «Plataforma de decisiones», así que un PIN pedido desde el ERP o
   * desde el portal interno llegaba con el nombre del motor. No es un detalle de marca: quien
   * recibe un código necesita saber a qué está entrando para reconocer un acceso que no pidió.
   */
  readonly product?: string | undefined;
}

/**
 * Envuelve el cuerpo en el membrete de ATLAS y devuelve un documento completo.
 *
 * Documento y no fragmento porque el HTML viaja tal cual dentro del MIME que
 * arma el transporte: no hay nadie más que le ponga `<head>`, y sin él no hay
 * juego de caracteres declarado —los acentos llegan rotos— ni `viewport`, con lo
 * que el móvil renderiza la tarjeta a 600 px y la encoge hasta hacerla ilegible.
 */
export function atlasMailShell(input: MailShellInput): string {
  return (
    '<!doctype html><html lang="es"><head>' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    // Impide que iOS Mail reajuste los tamaños de letra por su cuenta.
    '<meta name="x-apple-disable-message-reformatting">' +
    '<meta name="color-scheme" content="light dark">' +
    '<meta name="supported-color-schemes" content="light dark">' +
    `<title>${input.title}</title>` +
    '<style>' +
    "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');" +
    // Lo que se puede perder sin consecuencia: en un cliente que descarte este
    // bloque, la tarjeta se ve igual, sólo que sin adaptarse tan finamente.
    '@media (max-width:620px){.atlas-card{width:100%!important}' +
    '.atlas-pad{padding-left:24px!important;padding-right:24px!important}}' +
    `@media (prefers-color-scheme:dark){.atlas-body{background:${COLOR.codeSurface}!important}}` +
    '</style></head>' +
    `<body class="atlas-body" style="margin:0;padding:0;background:${COLOR.canvas};` +
    '-webkit-text-size-adjust:100%">' +
    preheader(input.preheader) +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="background:${COLOR.canvas};padding:32px 12px"><tr><td align="center">` +
    card(input) +
    legalLine() +
    '</td></tr></table></body></html>'
  );
}

/**
 * Texto que la bandeja lee y nadie ve. El bloque de espacios invisibles al final
 * es el truco clásico: sin él, el cliente rellena el resumen con las primeras
 * palabras del cuerpo y el preheader se lee cortado a la mitad.
 */
function preheader(text: string): string {
  return '<div style="display:none;max-height:0;overflow:hidden;opacity:0;' + `mso-hide:all">${text}${'&#8199;&#65279;'.repeat(40)}</div>`;
}

function card(input: MailShellInput): string {
  return (
    `<table role="presentation" class="atlas-card" cellpadding="0" cellspacing="0" border="0" ` +
    `width="600" style="width:600px;max-width:600px;background:${COLOR.surface};` +
    `border:1px solid ${COLOR.line};border-radius:16px;overflow:hidden">` +
    wordmark(input.product) +
    `<tr><td class="atlas-pad" style="padding:28px 40px 32px">` +
    `<div style="font-family:${FONT};font-size:11px;line-height:16px;font-weight:600;` +
    `color:${COLOR.accent};margin-bottom:6px">${input.eyebrow}</div>` +
    `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:22px;line-height:30px;` +
    `font-weight:700;color:${COLOR.ink}">${input.title}</h1>` +
    input.blocks.join('') +
    '</td></tr></table>'
  );
}

/**
 * El logotipo es TEXTO, no una imagen.
 *
 * Es además la única versalita espaciada admitida —la misma excepción que el
 * portal se concede—: aquí ese tratamiento identifica una marca, no rotula un
 * campo. Una imagen aparecería rota hasta que la persona pulse «mostrar
 * imágenes», que es lo que no hace en el correo que todavía no reconoce.
 */
/**
 * `ATLAS` y, al lado, el producto desde el que se pidió esto.
 *
 * Sin producto conocido se cae a «Plataforma corporativa», que es cierto para los tres y no afirma
 * de más. Antes el respaldo era «Plataforma de decisiones» y se enviaba SIEMPRE: el correo mentía
 * sobre su origen en dos de cada tres portales.
 */
function wordmark(product?: string): string {
  return (
    `<tr><td style="background:${COLOR.ink};padding:20px 40px">` +
    `<span style="font-family:${FONT};font-size:17px;line-height:24px;font-weight:700;` +
    `letter-spacing:.22em;color:${COLOR.surface}">ATLAS</span>` +
    `<span style="font-family:${FONT};font-size:11px;line-height:24px;font-weight:500;` +
    `letter-spacing:.08em;color:${COLOR.accentSoft};padding-left:12px">` +
    `${product ?? 'Plataforma corporativa'}</span></td></tr>`
  );
}

/**
 * Fuera de la tarjeta y en gris: dice quién manda esto y que no hay que
 * responder. Dentro competiría con el código, que es lo único que hay que leer.
 */
function legalLine(): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" ` +
    `style="width:600px;max-width:600px"><tr><td class="atlas-pad" align="center" ` +
    `style="padding:20px 40px 0;font-family:${FONT};font-size:11px;line-height:18px;` +
    `color:${COLOR.faint}">` +
    'Correo automático de ATLAS · no hace falta responder.<br>' +
    // Dice «contraseña ni código» y no sólo «código» porque uno de los cinco
    // correos entrega una contraseña temporal y ninguno un código: una advertencia
    // que no cubre el propio correo en el que aparece enseña a no leerla.
    'Nunca te pediremos tu contraseña ni un código por teléfono, chat, ni respondiendo a este mensaje.' +
    '</td></tr></table>'
  );
}
