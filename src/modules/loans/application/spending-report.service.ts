/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza emite el informe de gastos que el cliente puede guardar, imprimir o enseñar.
 * @system compone el PDF del reparto por rubro desde el libro de préstamos.
 */
import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { LoanSpendingService } from './loan-spending.service.js';

/** La marca, tomada de los mismos tokens que pinta la app. */
const BRAND = {
  navy: '#0C2C50',
  deep: '#052033',
  mint: '#2BE0A8',
  teal: '#14A894',
  ink: '#0B1E36',
  muted: '#5F7591',
  line: '#DCE5EF',
  paper: '#FFFFFF',
  danger: '#B23A3A',
  warning: '#B87A1F',
};

const MARGIN = 48;
const PAGE_WIDTH = 595.28; // A4 en puntos.

/**
 * Rubros a nombre legible.
 *
 * El expediente guarda el rubro en minúscula y sin acentos porque es una clave; un informe que la
 * imprime tal cual parece un volcado de base de datos. Lo que no esté en el mapa se capitaliza, que
 * es peor que un nombre cuidado y mejor que enseñar `sin_rubro`.
 */
const CATEGORY_LABELS: Record<string, string> = {
  educacion: 'Educación',
  electronica: 'Electrónica',
  celulares: 'Celulares y telefonía',
  ropa: 'Ropa y calzado',
  hogar: 'Hogar y muebles',
  salud: 'Salud y farmacia',
  supermercado: 'Supermercado',
  transporte: 'Transporte',
  servicios: 'Servicios',
  sin_rubro: 'Comercio sin rubro declarado',
  sin_comercio: 'Compras sin comercio registrado',
};

function labelFor(category: string): string {
  return CATEGORY_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, ' ');
}

/**
 * El boliviano se escribe «Bs», no «BOB».
 *
 * `BOB` es el codigo ISO: sirve para que dos sistemas se entiendan, no para que lo lea una persona.
 * Un informe que el cliente puede ensenar tiene que usar el simbolo que usa la app y el que usa
 * cualquier factura del pais; si no, el mismo importe parece de dos monedas distintas.
 */
function money(amount: number, currency: string): string {
  const text = amount.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === 'BOB' ? `Bs ${text}` : `${currency} ${text}`;
}

/**
 * El informe de gastos, en PDF y hecho por el SERVIDOR.
 *
 * ## Por qué no lo dibuja el teléfono
 *
 * Es un documento que alguien puede enseñar —a un banco, a su pareja, a un juzgado—. Si lo pinta el
 * dispositivo, cada motor de renderizado lo saca distinto y no queda ni rastro de qué se emitió;
 * dos capturas del mismo mes podrían no coincidir y nadie sabría cuál es la buena. Aquí sale
 * idéntico siempre y de los mismos números que alimentan la pantalla, porque los pide al mismo
 * servicio.
 *
 * ## Qué NO lleva
 *
 * Ni la calificación crediticia ni el detalle de mora por crédito. Un informe de gastos que además
 * publica el riesgo de quien lo enseña se convierte en un documento que conviene no enseñar, y
 * entonces deja de servir para lo que se pidió.
 */
@Injectable()
export class SpendingReportService {
  constructor(
    private readonly spending: LoanSpendingService,
    private readonly customers: CustomersRepository,
  ) {}

  async pdf(tenantId: string, customerId: string): Promise<Buffer> {
    const [data, profile] = await Promise.all([
      this.spending.byCategory(tenantId, customerId),
      /*
       * El nombre va en el informe porque es un documento que la persona ensena: sin el, cualquiera
       * podria decir que es suyo. Si el expediente aun no lo tiene, la linea simplemente no sale —
       * mejor un informe sin nombre que uno con un hueco donde deberia haber un dato.
       */
      this.customers.findCurrentProfile(tenantId, customerId).catch(() => null),
    ]);
    const customerName = profile ? [profile.firstName, profile.lastName].filter(Boolean).join(' ') || null : null;
    const document = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });

    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<Buffer>((resolve) => document.on('end', () => resolve(Buffer.concat(chunks))));

    this.header(document, customerName, data.generatedAt);
    this.totals(document, data);
    this.categories(document, data);
    this.footer(document, data);

    document.end();
    return finished;
  }

  /**
   * La cabecera con la marca.
   *
   * El logo se DIBUJA con primitivas en vez de incrustar un mapa de bits: un PNG pierde nitidez al
   * imprimir y obliga a versionar un binario junto al código. La marca de Atlas es una forma
   * geométrica simple, así que dibujarla sale mejor y pesa nada.
   */
  private header(document: PDFKit.PDFDocument, customerName: string | null, generatedAt: string): void {
    document.rect(0, 0, PAGE_WIDTH, 132).fill(BRAND.navy);

    // La marca: un arco ascendente sobre una base, que es el gesto del logotipo.
    const originX = MARGIN;
    const originY = 46;
    document.save();
    document.lineWidth(4).lineCap('round');
    document
      .moveTo(originX, originY + 26)
      .lineTo(originX + 13, originY)
      .lineTo(originX + 26, originY + 26)
      .stroke(BRAND.mint);
    document
      .moveTo(originX + 7, originY + 17)
      .lineTo(originX + 19, originY + 17)
      .stroke(BRAND.teal);
    document.restore();

    document
      .fillColor(BRAND.paper)
      .font('Helvetica-Bold')
      .fontSize(22)
      .text('Atlas', originX + 38, originY + 2);
    document
      .fillColor(BRAND.mint)
      .font('Helvetica')
      .fontSize(9)
      .text('INFORME DE GASTOS POR CATEGORÍA', originX + 38, originY + 28, { characterSpacing: 1.2 });

    /*
     * Sin nombre no se escribe la linea. Antes salia «Cliente» a secas, que no identifica a nadie y
     * deja el documento con un hueco donde deberia haber un dato.
     */
    let cursor = 96;
    if (customerName) {
      document
        .fillColor('#9FB4CC')
        .font('Helvetica')
        .fontSize(9)
        .text(`Emitido para ${customerName}`, MARGIN, cursor, {
          width: PAGE_WIDTH - MARGIN * 2,
        });
      cursor += 12;
    }
    document
      .fillColor('#9FB4CC')
      .font('Helvetica')
      .fontSize(9)
      .text(`Generado el ${new Date(generatedAt).toLocaleString('es-BO')}`, MARGIN, cursor);

    document.y = 160;
  }

  /** Los cuatro números que resumen la situación, en fila. */
  private totals(document: PDFKit.PDFDocument, data: Awaited<ReturnType<LoanSpendingService['byCategory']>>): void {
    const cards = [
      { label: 'Financiado', value: money(data.totals.financed, data.currencyCode), tone: BRAND.ink },
      { label: 'Pagado', value: money(data.totals.paid, data.currencyCode), tone: BRAND.teal },
      { label: 'Por pagar', value: money(data.totals.outstanding, data.currencyCode), tone: BRAND.ink },
      {
        label: 'En mora',
        value: money(data.totals.overdue, data.currencyCode),
        tone: data.totals.overdue > 0 ? BRAND.danger : BRAND.muted,
      },
    ];

    const usable = PAGE_WIDTH - MARGIN * 2;
    const gap = 10;
    const width = (usable - gap * (cards.length - 1)) / cards.length;
    const top = document.y;

    cards.forEach((card, index) => {
      const x = MARGIN + index * (width + gap);
      document.roundedRect(x, top, width, 62, 8).fillAndStroke('#F5F8FC', BRAND.line);
      document
        .fillColor(BRAND.muted)
        .font('Helvetica')
        .fontSize(8)
        .text(card.label.toUpperCase(), x + 10, top + 12, { width: width - 20 });
      document
        .fillColor(card.tone)
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(card.value, x + 10, top + 28, { width: width - 20 });
    });

    document.y = top + 86;
  }

  /**
   * El reparto por rubro, con barra proporcional.
   *
   * La barra usa el porcentaje que ya calculó el servicio y no uno recalculado aquí: dos sitios que
   * dividen lo mismo acaban discrepando en el redondeo, y entonces el PDF y la pantalla enseñan
   * repartos distintos del mismo dinero.
   */
  private categories(document: PDFKit.PDFDocument, data: Awaited<ReturnType<LoanSpendingService['byCategory']>>): void {
    document.fillColor(BRAND.ink).font('Helvetica-Bold').fontSize(13).text('Reparto por categoría', MARGIN, document.y);
    document.moveDown(0.6);

    if (data.categories.length === 0) {
      document
        .fillColor(BRAND.muted)
        .font('Helvetica')
        .fontSize(10)
        .text('Todavía no hay compras financiadas que repartir.', MARGIN, document.y);
      return;
    }

    const usable = PAGE_WIDTH - MARGIN * 2;

    for (const category of data.categories) {
      if (document.y > 690) {
        document.addPage();
        document.y = MARGIN;
      }

      const top = document.y;
      document.fillColor(BRAND.ink).font('Helvetica-Bold').fontSize(10).text(labelFor(category.category), MARGIN, top);
      document
        .fillColor(BRAND.ink)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(money(category.financed, data.currencyCode), MARGIN, top, { width: usable, align: 'right' });

      document
        .fillColor(BRAND.muted)
        .font('Helvetica')
        .fontSize(8)
        .text(
          `${category.share.toFixed(1)} % · ${category.loanCount} ${category.loanCount === 1 ? 'compra' : 'compras'}` +
            (category.overdue > 0 ? ` · ${money(category.overdue, data.currencyCode)} en mora` : ''),
          MARGIN,
          top + 14,
        );

      const barTop = top + 28;
      document.roundedRect(MARGIN, barTop, usable, 6, 3).fill('#E9EFF6');
      const filled = Math.max(4, (usable * Math.min(category.share, 100)) / 100);
      document.roundedRect(MARGIN, barTop, filled, 6, 3).fill(category.overdue > 0 ? BRAND.warning : BRAND.teal);

      let cursor = barTop + 14;
      for (const merchant of category.merchants.slice(0, 4)) {
        document
          .fillColor(BRAND.muted)
          .font('Helvetica')
          .fontSize(8)
          .text(`· ${merchant.displayName}`, MARGIN + 8, cursor, { width: usable * 0.6, ellipsis: true });
        document
          .fillColor(BRAND.muted)
          .font('Helvetica')
          .fontSize(8)
          .text(money(merchant.financed, data.currencyCode), MARGIN, cursor, { width: usable, align: 'right' });
        cursor += 12;
      }

      document.y = cursor + 10;
    }
  }

  /**
   * El pie dice de dónde salen los números.
   *
   * Un informe que no declara su fuente ni su fecha de corte se vuelve inútil en cuanto pasa una
   * semana: nadie sabe si sigue siendo cierto. Aquí queda dicho que sale del libro de préstamos y
   * en qué momento se cortó.
   */
  private footer(document: PDFKit.PDFDocument, data: Awaited<ReturnType<LoanSpendingService['byCategory']>>): void {
    const range = document.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      document.switchToPage(index);

      /*
       * El pie se escribe POR DEBAJO del margen inferior, y pdfkit reacciona a eso creando una
       * página nueva: un informe de una categoría salía en tres hojas, dos de ellas en blanco. Se
       * anula el margen mientras se pinta el pie y se restaura después, que es la única forma de
       * escribir en esa franja sin provocar el salto.
       */
      const bottomMargin = document.page.margins.bottom;
      document.page.margins.bottom = 0;
      document
        .fillColor(BRAND.muted)
        .font('Helvetica')
        .fontSize(7.5)
        .text(
          'Elaborado por Atlas a partir del libro de préstamos. Importes en ' +
            `${data.currencyCode === 'BOB' ? 'bolivianos' : data.currencyCode}. Corte: ${new Date(data.generatedAt).toLocaleString('es-BO')}.`,
          MARGIN,
          800,
          { width: PAGE_WIDTH - MARGIN * 2 },
        );
      document.text(`Página ${index + 1} de ${range.count}`, MARGIN, 800, { width: PAGE_WIDTH - MARGIN * 2, align: 'right' });
      document.page.margins.bottom = bottomMargin;
    }
  }
}
