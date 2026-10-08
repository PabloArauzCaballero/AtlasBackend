/**
 * @file Servicio de aplicación: el extracto de crédito del cliente en PDF.
 * @business Pablo (2026-10-08): «se debe poder descargar el PDF» del extracto. Es lo que la persona enseña para
 *   demostrar qué compró, qué pagó y qué debe, así que sale del SERVIDOR, idéntico en cualquier teléfono.
 * @system lee los préstamos con `LoanQueryService` (los mismos datos de la pantalla) y los dibuja con
 *   `credit-statement.layout.ts`.
 */
import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { LoanQueryService } from './loan-query.service.js';
import { SpendingReportService } from './spending-report.service.js';
import {
  ALTO_PAGINA,
  cabecera,
  type Celda,
  datosDelDocumento,
  dinero,
  fechaCorta,
  MARCA,
  MARGEN,
  pies,
  tabla,
  tarjetas,
  tituloDeSeccion,
} from './credit-statement.layout.js';

type Detalle = Awaited<ReturnType<LoanQueryService['detail']>>;

export type Movimiento = { fecha: string; concepto: string; cargo: number; abono: number; saldo: number };
export type CuotaPorPagar = { fecha: string; concepto: string; importe: number; vencida: boolean };

const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/** Los números del extracto, sin PDF: lo que se prueba. Misma regla que la pantalla de la app. */
export function cuentasDelExtracto(creditos: readonly Detalle[], hoy: string) {
  const filas: Omit<Movimiento, 'saldo'>[] = [];
  const proximas: CuotaPorPagar[] = [];
  for (const c of creditos) {
    const comercio = c.merchant?.displayName ?? 'Atlas';
    if (c.disbursedAt)
      filas.push({
        fecha: new Date(c.disbursedAt).toISOString(),
        concepto: `Compra en ${comercio}`,
        cargo: n(c.principalAmount),
        abono: 0,
      });
    for (const p of c.payments) {
      if (p.status === 'reversed') continue;
      filas.push({ fecha: new Date(p.receivedAt).toISOString(), concepto: `Pago a ${comercio}`, cargo: 0, abono: n(p.amount) });
    }
    for (const q of c.schedule) {
      if (q.status === 'paid' || q.status === 'written_off') continue;
      const falta =
        n(q.principalAmount) + n(q.interestAmount) + n(q.lateFeeAmount) - (n(q.paidPrincipal) + n(q.paidInterest) + n(q.paidLateFee));
      proximas.push({
        fecha: String(q.dueDate),
        concepto: `Cuota ${q.installmentNumber} de ${c.termMonths} · ${comercio}`,
        importe: Math.max(0, Math.round(falta * 100) / 100),
        vencida: String(q.dueDate) < hoy,
      });
    }
  }
  filas.sort((a, b) => a.fecha.localeCompare(b.fecha));
  let saldo = 0;
  const movimientos = filas.map((f) => {
    saldo = Math.round((saldo + f.cargo - f.abono) * 100) / 100;
    return { ...f, saldo };
  });
  proximas.sort((a, b) => a.fecha.localeCompare(b.fecha));
  const financiado = movimientos.reduce((t, m) => t + m.cargo, 0);
  const pagado = movimientos.reduce((t, m) => t + m.abono, 0);
  return { movimientos, proximas, financiado, pagado, saldo };
}

@Injectable()
export class CreditStatementService {
  constructor(
    private readonly queries: LoanQueryService,
    private readonly report: SpendingReportService,
  ) {}

  async pdf(tenantId: string, customerId: string, ahora = new Date()): Promise<Buffer> {
    const { items } = await this.queries.listByCustomer(tenantId, customerId);
    const [detalles, nombre] = await Promise.all([
      Promise.all(items.map((loan) => this.queries.detail(tenantId, String(loan.loanId)))),
      this.report.nombreDelCliente(tenantId, customerId),
    ]);
    const cuentas = cuentasDelExtracto(detalles, ahora.toISOString().slice(0, 10));

    const doc = new PDFDocument({ size: 'A4', margin: MARGEN, bufferPages: true });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    const listo = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(partes))));

    cabecera(doc, 'Extracto de crédito', 'Tus compras con Atlas, lo que pagaste y lo que debes a la fecha de emisión.');
    let y = datosDelDocumento(
      doc,
      [
        ...(nombre ? ([['Emitido para', nombre]] as [string, string][]) : []),
        ['Fecha de emisión', ahora.toLocaleString('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'long', timeStyle: 'short' })],
        ['Créditos incluidos', String(detalles.length)],
      ],
      140,
    );
    y = tarjetas(
      doc,
      [
        { etiqueta: 'Financiado', valor: dinero(cuentas.financiado), tono: MARCA.tinta },
        { etiqueta: 'Pagado', valor: dinero(cuentas.pagado), tono: MARCA.verde },
        { etiqueta: 'Debes hoy', valor: dinero(cuentas.saldo), tono: MARCA.navy },
      ],
      y,
    );

    y = this.lasCuotasPorPagar(doc, cuentas, y);
    this.losMovimientos(doc, cuentas, y);

    pies(
      doc,
      'Documento informativo emitido por Atlas con los datos registrados a la fecha de emisión. Los pagos se acreditan cuando el comercio los confirma.',
    );
    doc.end();
    return listo;
  }

  private lasCuotasPorPagar(doc: PDFKit.PDFDocument, cuentas: ReturnType<typeof cuentasDelExtracto>, desde: number): number {
    let y = desde;
    y = tituloDeSeccion(doc, 'Lo que viene', 'Tus cuotas por pagar, de la más cercana a la más lejana.', y);
    const filasProximas: Celda[][] = cuentas.proximas.length
      ? cuentas.proximas.map((q) => [
          { texto: fechaCorta(q.fecha) },
          { texto: q.concepto },
          { texto: q.vencida ? 'Vencida' : 'Por pagar', tono: q.vencida ? MARCA.peligro : MARCA.aviso, negrita: true },
          { texto: dinero(q.importe), negrita: true },
        ])
      : [[{ texto: '—' }, { texto: 'No tienes cuotas pendientes.' }, { texto: '' }, { texto: '' }]];
    return tabla(
      doc,
      [
        { titulo: 'Vence', ancho: 90 },
        { titulo: 'Concepto', ancho: 230 },
        { titulo: 'Estado', ancho: 80 },
        { titulo: 'Importe', ancho: 107.28, alinear: 'right' },
      ],
      filasProximas,
      y,
    );
  }

  private losMovimientos(doc: PDFKit.PDFDocument, cuentas: ReturnType<typeof cuentasDelExtracto>, desde: number): number {
    let y = desde;
    if (y > ALTO_PAGINA - 160) {
      doc.addPage();
      y = MARGEN;
    }
    y = tituloDeSeccion(
      doc,
      'Movimientos',
      'Cada compra suma a lo que debes y cada pago lo resta. El saldo es lo que debías después de cada movimiento.',
      y,
    );
    const filasMov: Celda[][] = cuentas.movimientos.length
      ? cuentas.movimientos.map((m) => [
          { texto: fechaCorta(m.fecha) },
          { texto: m.concepto },
          { texto: m.cargo ? dinero(m.cargo) : '' },
          { texto: m.abono ? dinero(m.abono) : '', tono: MARCA.verde },
          { texto: dinero(m.saldo), negrita: true },
        ])
      : [[{ texto: '—' }, { texto: 'Todavía no hay movimientos.' }, { texto: '' }, { texto: '' }, { texto: '' }]];
    return tabla(
      doc,
      [
        { titulo: 'Fecha', ancho: 82 },
        { titulo: 'Concepto', ancho: 175 },
        { titulo: 'Cargo', ancho: 82, alinear: 'right' },
        { titulo: 'Abono', ancho: 82, alinear: 'right' },
        { titulo: 'Saldo', ancho: 86.28, alinear: 'right' },
      ],
      filasMov,
      y,
    );
  }
}
