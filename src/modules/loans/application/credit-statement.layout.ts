/**
 * @file Maqueta del extracto de crédito en PDF: marca, resumen, tablas y pie, dibujados con pdfkit.
 * @business Pablo (2026-10-08): «el PDF descargable sigue muy básico». Es un documento que se enseña, así que se cuida
 *   como el extracto de un banco: jerarquía clara, cifras alineadas, filas alternadas y paginado.
 * @system funciones puras sobre un `PDFDocument`; no leen base de datos.
 */
export const MARCA = {
  navy: '#0C2C50',
  profundo: '#06192E',
  menta: '#2BE0A8',
  verde: '#14A894',
  tinta: '#0B1E36',
  apagado: '#5F7591',
  linea: '#DCE5EF',
  fila: '#F4F8FB',
  papel: '#FFFFFF',
  peligro: '#B23A3A',
  aviso: '#B87A1F',
};

export const MARGEN = 44;
export const ANCHO_PAGINA = 595.28; // A4 en puntos.
export const ALTO_PAGINA = 841.89;
const UTIL = ANCHO_PAGINA - MARGEN * 2;

export function dinero(monto: number, moneda = 'BOB'): string {
  const texto = monto.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'BOB' ? `Bs ${texto}` : `${moneda} ${texto}`;
}

export function fechaCorta(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return d.toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** La «A» de Atlas, dibujada: nítida al imprimir y sin binarios versionados. */
function logo(doc: PDFKit.PDFDocument, x: number, y: number, lado: number): void {
  doc.save();
  doc
    .lineWidth(lado * 0.16)
    .lineCap('round')
    .lineJoin('round');
  doc
    .moveTo(x, y + lado)
    .lineTo(x + lado / 2, y)
    .lineTo(x + lado, y + lado)
    .stroke(MARCA.menta);
  doc
    .moveTo(x + lado * 0.27, y + lado * 0.66)
    .lineTo(x + lado * 0.73, y + lado * 0.66)
    .stroke(MARCA.verde);
  doc.restore();
}

/** La cabecera de marca: franja oscura, logo, título y la línea de acento. */
export function cabecera(doc: PDFKit.PDFDocument, titulo: string, subtitulo: string): void {
  doc.rect(0, 0, ANCHO_PAGINA, 118).fill(MARCA.profundo);
  doc.rect(0, 118, ANCHO_PAGINA, 4).fill(MARCA.menta);
  // Un arco tenue detrás del logo: profundidad sin imágenes.
  doc
    .save()
    .circle(ANCHO_PAGINA - 60, 20, 120)
    .fillOpacity(0.08)
    .fill(MARCA.menta)
    .restore();
  logo(doc, MARGEN, 38, 30);
  doc
    .fillColor(MARCA.papel)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('Atlas', MARGEN + 44, 38);
  doc
    .fillColor(MARCA.menta)
    .font('Helvetica')
    .fontSize(8.5)
    .text(titulo.toUpperCase(), MARGEN + 44, 64, { characterSpacing: 1.6 });
  doc.fillColor('#9FB4CC').fontSize(8.5).text(subtitulo, MARGEN, 92, { width: UTIL });
}

/** Un bloque de datos del documento: a quién y cuándo. */
export function datosDelDocumento(doc: PDFKit.PDFDocument, filas: [string, string][], y: number): number {
  const alto = 18 + filas.length * 15;
  doc.roundedRect(MARGEN, y, UTIL, alto, 8).fill(MARCA.fila);
  filas.forEach(([etiqueta, valor], i) => {
    const fy = y + 10 + i * 15;
    doc
      .fillColor(MARCA.apagado)
      .font('Helvetica')
      .fontSize(8.5)
      .text(etiqueta, MARGEN + 14, fy, { width: 140 });
    doc
      .fillColor(MARCA.tinta)
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text(valor, MARGEN + 160, fy, { width: UTIL - 174 });
  });
  return y + alto + 18;
}

/** Tarjetas de resumen en fila, con el borde superior del color de cada cifra. */
export function tarjetas(doc: PDFKit.PDFDocument, items: { etiqueta: string; valor: string; tono: string }[], y: number): number {
  const separacion = 10;
  const ancho = (UTIL - separacion * (items.length - 1)) / items.length;
  items.forEach((item, i) => {
    const x = MARGEN + i * (ancho + separacion);
    doc.roundedRect(x, y, ancho, 64, 8).lineWidth(1).fillAndStroke(MARCA.papel, MARCA.linea);
    doc.rect(x, y, ancho, 4).fill(item.tono);
    doc
      .fillColor(MARCA.apagado)
      .font('Helvetica')
      .fontSize(7.5)
      .text(item.etiqueta.toUpperCase(), x + 12, y + 16, { width: ancho - 24, characterSpacing: 1 });
    doc
      .fillColor(item.tono)
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(item.valor, x + 12, y + 32, { width: ancho - 24 });
  });
  return y + 64 + 24;
}

export function tituloDeSeccion(doc: PDFKit.PDFDocument, titulo: string, detalle: string, y: number): number {
  doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(12).text(titulo, MARGEN, y);
  doc
    .fillColor(MARCA.apagado)
    .font('Helvetica')
    .fontSize(8.5)
    .text(detalle, MARGEN, y + 16, { width: UTIL });
  return y + 36;
}

export type Columna = { titulo: string; ancho: number; alinear?: 'left' | 'right' };
export type Celda = { texto: string; tono?: string; negrita?: boolean };

/**
 * Una tabla con cabecera, filas alternadas y salto de página: si la fila no cabe, se cierra la página, se abre otra
 * y se repite la cabecera, para que ninguna fila quede huérfana de sus columnas.
 */
export function tabla(doc: PDFKit.PDFDocument, columnas: Columna[], filas: Celda[][], y: number): number {
  const ALTO_FILA = 22;
  const pintarCabecera = (cy: number) => {
    doc.rect(MARGEN, cy, UTIL, ALTO_FILA).fill(MARCA.navy);
    let x = MARGEN;
    for (const c of columnas) {
      doc
        .fillColor(MARCA.papel)
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .text(c.titulo.toUpperCase(), x + 8, cy + 7.5, { width: c.ancho - 16, align: c.alinear ?? 'left', characterSpacing: 0.6 });
      x += c.ancho;
    }
    return cy + ALTO_FILA;
  };
  let cy = pintarCabecera(y);
  filas.forEach((fila, i) => {
    if (cy + ALTO_FILA > ALTO_PAGINA - 70) {
      doc.addPage();
      cy = pintarCabecera(MARGEN);
    }
    if (i % 2 === 1) doc.rect(MARGEN, cy, UTIL, ALTO_FILA).fill(MARCA.fila);
    let x = MARGEN;
    fila.forEach((celda, j) => {
      const c = columnas[j]!;
      doc
        .fillColor(celda.tono ?? MARCA.tinta)
        .font(celda.negrita ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(8.5)
        .text(celda.texto, x + 8, cy + 7, { width: c.ancho - 16, align: c.alinear ?? 'left', lineBreak: false, ellipsis: true });
      x += c.ancho;
    });
    cy += ALTO_FILA;
  });
  doc
    .moveTo(MARGEN, cy)
    .lineTo(MARGEN + UTIL, cy)
    .lineWidth(0.6)
    .stroke(MARCA.linea);
  return cy + 24;
}

/** El pie en TODAS las páginas: nota y «página n de m». Se escribe al final, con `bufferPages`. */
export function pies(doc: PDFKit.PDFDocument, nota: string): void {
  const rango = doc.bufferedPageRange();
  for (let i = rango.start; i < rango.start + rango.count; i += 1) {
    doc.switchToPage(i);
    // Por debajo del margen inferior pdfkit abriría otra página: se anula el margen mientras se escribe el pie.
    const margenAbajo = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .moveTo(MARGEN, ALTO_PAGINA - 46)
      .lineTo(ANCHO_PAGINA - MARGEN, ALTO_PAGINA - 46)
      .lineWidth(0.6)
      .stroke(MARCA.linea);
    doc
      .fillColor(MARCA.apagado)
      .font('Helvetica')
      .fontSize(7)
      .text(nota, MARGEN, ALTO_PAGINA - 38, { width: UTIL - 80, lineBreak: true });
    doc.text(`Página ${i - rango.start + 1} de ${rango.count}`, ANCHO_PAGINA - MARGEN - 80, ALTO_PAGINA - 38, {
      width: 80,
      align: 'right',
    });
    doc.page.margins.bottom = margenAbajo;
  }
}
