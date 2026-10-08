/**
 * @file Buscadores y resúmenes de las colas de operaciones contra PostgreSQL real (auditoría 2026-09-29).
 * @business Un buscador que no busca o una cifra sacada de la página hacen que operaciones decida sobre una lista falsa.
 * @system ejecuta el SQL nuevo (subconsultas a `customers`, `ANY($ids::bigint[])`, COUNT con JOIN, GROUP BY) contra
 *   la base de integración: filtra con datos que lo distinguen y NO confunde comodines de LIKE con texto.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import {
  CustomerContactMethodModel,
  CustomerModel,
  DataSubjectRequestModel,
  FraudCaseModel,
  ManualReviewCaseModel,
  OutboxEventModel,
} from '../../../src/database/models/index.js';
import { OperationsQueueRepository } from '../../../src/modules/operations/operations-queue.repository.js';
import { PendingContactVerificationService } from '../../../src/modules/operations/pending-contact-verification.service.js';
import { EventsRepository } from '../../../src/modules/events/events.repository.js';
import { OperationsPrivacyRequestsService } from '../../../src/modules/customer-privacy/operations-privacy-requests.service.js';
import { OperationsPaymentClaimsService } from '../../../src/modules/loan-payment-claims/operations-payment-claims.service.js';
import { operationsPrivacyRequestsQuerySchema } from '../../../src/modules/customer-privacy/operations-privacy-requests.schemas.js';
import { operationsClaimsQuerySchema } from '../../../src/modules/loan-payment-claims/loan-payment-claims.schemas.js';
import { listEventsQuerySchema } from '../../../src/modules/events/events.schemas.js';
import { workQueueQuerySchema } from '../../../src/modules/operations/operations.schemas.js';
import { buildLoanBookHarness, type LoanBookHarness } from '../credit/support/loan-book-harness.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
let h: LoanBookHarness | null = null;
const token = runToken();
const codigo = (sufijo: string) => `WP5${token}${sufijo}`.toUpperCase();

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (database) h = await buildLoanBookHarness(database.sequelize);
});

afterAll(async () => {
  if (h) {
    const tenantId = h.tenantId;
    await CustomerContactMethodModel.destroy({ where: { tenantId } });
    await ManualReviewCaseModel.destroy({ where: { tenantId } });
    await FraudCaseModel.destroy({ where: { tenantId } });
    await DataSubjectRequestModel.destroy({ where: { tenantId } });
  }
  await h?.cleanup();
  await database?.close();
});

async function cliente(tenantId: string, customerCode: string): Promise<string> {
  const now = new Date();
  const row = await CustomerModel.create({
    tenantId,
    customerCode,
    customerUuid: randomUUID(),
    lifecycleStatus: 'active',
    createdAtValue: now,
    updatedAtValue: now,
    deleted: false,
  });
  return String(row.id);
}

describe('buscadores de operaciones (PostgreSQL real)', () => {
  it('préstamos: q por parte del código del cliente o del préstamo; «%» no es comodín; códigos de cliente en UNA consulta', async () => {
    if (!h) return;
    const loan = await h.createLoan('910101');
    const customer = await CustomerModel.findByPk(loan.customerId);
    const code = customer!.customerCode!;
    const loanRow = await h.loansRepository.findLoanById(h.tenantId, loan.loanId);
    const loanCode = loanRow!.loanCode!;

    const porCliente = await h.loansRepository.findLoansPage(h.tenantId, { q: code.slice(2, 8).toLowerCase() }, { limit: 10, offset: 0 });
    expect(porCliente.rows.map((row) => String(row.id))).toContain(loan.loanId);
    const porPrestamo = await h.loansRepository.findLoansPage(h.tenantId, { q: loanCode.slice(-4) }, { limit: 10, offset: 0 });
    expect(porPrestamo.rows.map((row) => String(row.id))).toContain(loan.loanId);
    const comodin = await h.loansRepository.findLoansPage(h.tenantId, { q: '%' }, { limit: 10, offset: 0 });
    expect(comodin.count).toBe(0);
    const nada = await h.loansRepository.findLoansPage(h.tenantId, { q: 'no-existe-zz' }, { limit: 10, offset: 0 });
    expect(nada.count).toBe(0);

    const codes = await h.loansRepository.findCustomerCodes(h.tenantId, [loan.customerId]);
    expect(codes.get(loan.customerId)).toBe(code);
  });

  it('cola de trabajo: q por código de cliente (subconsulta) y por código de caso, contados por tipo', async () => {
    if (!h || !database) return;
    const tenantId = h.tenantId;
    const ana = await cliente(tenantId, codigo('ANA'));
    const beto = await cliente(tenantId, codigo('BETO'));
    const now = new Date();
    await ManualReviewCaseModel.create({
      tenantId,
      caseCode: codigo('MR1'),
      customerId: ana,
      status: 'open',
      priority: 'high',
      createdAtValue: now,
      deleted: false,
    } as never);
    await ManualReviewCaseModel.create({
      tenantId,
      caseCode: codigo('MR2'),
      customerId: beto,
      status: 'open',
      priority: 'low',
      createdAtValue: now,
      deleted: false,
    } as never);
    await FraudCaseModel.create({
      tenantId,
      caseCode: codigo('FR1'),
      customerId: ana,
      caseStatus: 'open',
      severity: 'high',
      createdAtValue: now,
      deleted: false,
    } as never);

    const cola = new OperationsQueueRepository(
      ManualReviewCaseModel,
      FraudCaseModel,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const query = workQueueQuerySchema.parse({ queue: 'manual_review', q: `${token}ana`.toLowerCase() });
    const manual = await cola.findManualReviewCasesForQueue(tenantId, query);
    expect(manual.rows.map((row) => row.caseCode)).toEqual([codigo('MR1')]);
    expect(await cola.countFraudCases(tenantId, query)).toBe(1);
    expect(await cola.countManualReviewCases(tenantId, workQueueQuerySchema.parse({ q: codigo('MR2') }))).toBe(1);
    expect(await cola.countManualReviewCases(tenantId, workQueueQuerySchema.parse({ q: '_' }))).toBe(0);
  });

  it('contactos sin verificar: página, total, resumen de TODA la cola y filtros', async () => {
    if (!h || !database) return;
    const tenantId = h.tenantId;
    const carla = await cliente(tenantId, codigo('CARLA'));
    const now = new Date();
    const contacto = (contactType: string, valueLast4: string, emailDomain: string | null) =>
      CustomerContactMethodModel.create({
        tenantId,
        customerId: carla,
        contactType,
        contactValueHash: randomUUID(),
        normalizedValueHash: randomUUID(),
        valueLast4,
        emailDomain,
        isPrimary: true,
        status: 'unverified',
        sourceType: 'it',
        createdAtValue: now,
        deleted: false,
      } as never);
    await contacto('email', 'a.bo', 'upsa.edu.bo');
    await contacto('phone', '7788', null);
    await contacto('phone', '1234', null);

    const service = new PendingContactVerificationService(database.sequelize as never);
    const todo = await service.list(tenantId, { page: 1, limit: 2 });
    expect(todo.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(todo.items).toHaveLength(2);
    expect(todo.summary).toEqual({ total: 3, email: 1, phone: 2 });

    const telefonos = await service.list(tenantId, { page: 1, limit: 25, contactType: 'phone', q: '7788' });
    expect(telefonos.items.map((item) => item.valueLast4)).toEqual(['7788']);
    expect(telefonos.summary.total).toBe(3);
    expect((await service.list(tenantId, { page: 1, limit: 25, q: 'UPSA' })).meta.total).toBe(1);
    expect((await service.list(tenantId, { page: 1, limit: 25, q: '%' })).meta.total).toBe(0);
  });

  it('eventos: q por parte de código/agregado/correlación y resumen por estado con los mismos filtros', async () => {
    if (!h || !database) return;
    const tenantId = h.tenantId;
    const evento = (eventCode: string, status: string, correlationId: string | null) =>
      OutboxEventModel.create({
        tenantId,
        aggregateType: 'wp5_it',
        eventCode,
        status,
        attempts: 0,
        correlationId,
        createdAtValue: new Date(),
      } as never);
    await evento(`wp5.${token}.alpha`, 'failed', null);
    await evento(`wp5.${token}.beta`, 'pending', `corr-${token}`);
    await evento(`wp5.${token}.gamma`, 'failed', null);

    const repo = new EventsRepository(OutboxEventModel, database.sequelize as never);
    const q = listEventsQuerySchema.parse({ q: `${token}.ALPHA` });
    expect((await repo.list(tenantId, q)).count).toBe(1);
    expect((await repo.list(tenantId, listEventsQuerySchema.parse({ q: `corr-${token}` }))).count).toBe(1);
    const porEstado = await repo.countByStatus(tenantId, listEventsQuerySchema.parse({ q: `wp5.${token}`, status: 'failed' }));
    expect(porEstado).toEqual({ failed: 2, pending: 1 });
  });

  it('privacidad y avisos de pago: q con el JOIN en el conteo (el SQL corre y filtra)', async () => {
    if (!h || !database) return;
    const tenantId = h.tenantId;
    const dana = await cliente(tenantId, codigo('DANA'));
    const now = new Date();
    await DataSubjectRequestModel.create({
      tenantId,
      requestCode: codigo('DSR1'),
      customerId: dana,
      requestType: 'access',
      status: 'received',
      requestedAt: now,
      createdAtValue: now,
      deleted: false,
    } as never);
    await DataSubjectRequestModel.create({
      tenantId,
      requestCode: codigo('DSR2'),
      customerId: null,
      requestType: 'erasure',
      status: 'received',
      requestedAt: now,
      createdAtValue: now,
      deleted: false,
    } as never);

    const privacy = new OperationsPrivacyRequestsService({} as never, database.sequelize as never);
    const porCliente = await privacy.list(tenantId, operationsPrivacyRequestsQuerySchema.parse({ q: `${token}dana`.toLowerCase() }));
    expect(porCliente.meta.total).toBe(1);
    expect(porCliente.items[0]?.requestCode).toBe(codigo('DSR1'));
    expect((await privacy.list(tenantId, operationsPrivacyRequestsQuerySchema.parse({ q: codigo('DSR2') }))).meta.total).toBe(1);

    const claims = new OperationsPaymentClaimsService(database.sequelize as never);
    const avisos = await claims.list(tenantId, operationsClaimsQuerySchema.parse({ q: 'no-existe-zz' }));
    expect(avisos.meta.total).toBe(0);
  });
});
