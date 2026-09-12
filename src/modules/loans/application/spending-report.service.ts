/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza emite el informe de gastos que el cliente puede guardar, imprimir o enseñar.
 * @system compone el PDF del reparto por rubro desde el libro de préstamos.
 */
import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { LoanSpendingService } from './loan-spending.service.js';

const MARGIN = 48;

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
import { SpendingReportLayoutService } from './spending-report.layout.service.js';
@Injectable()
export class SpendingReportService {
  constructor(
    private readonly spending: LoanSpendingService,
    private readonly customers: CustomersRepository,
    private readonly maqueta: SpendingReportLayoutService,
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

    this.maqueta.header(document, customerName, data.generatedAt);
    this.maqueta.totals(document, data);
    this.maqueta.categories(document, data);
    this.maqueta.footer(document, data);

    document.end();
    return finished;
  }
}
