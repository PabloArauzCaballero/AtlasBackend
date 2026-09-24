/**
 * @file Conductor de la prueba de extremo a extremo LOCAL Core ↔ ERP (P-14 · B20). No es una suite de
 *   Jest: lo lanza a mano quien verifica, con Core y el ERP compilados y levantados.
 * @business Demuestra con los procesos reales que un `payment.confirmed` de Core confirma el aviso en el
 *   ERP una sola vez aunque se reenvíe diez veces.
 * @system Dos fases, con las variables `DB_*` + `ATLAS_TEST_DATABASE_ISOLATED=true` de la base de Core:
 *
 *   tsx test/integration/erp-integration/e2e-driver.ts prepare
 *     → crea tenant, cliente y un préstamo de 3 cuotas; imprime JSON con los ids (para sembrar el ERP).
 *   ERP_URL=http://127.0.0.1:3907/api/v1/integration/core/events ERP_SECRET=… \
 *   tsx test/integration/erp-integration/e2e-driver.ts confirm <tenantId> <loanId> <installmentId> <partnerId>
 *     → reporta y confirma el aviso de esa cuota y entrega sus eventos al ERP con el servicio real,
 *       reencolando la confirmación nueve veces más (ACK perdido / reintento). Imprime lo entregado.
 */
import { QueryTypes } from 'sequelize';
import { randomUUID } from 'node:crypto';
import { ErpEventDeliveryService } from '../../../src/modules/erp-integration/erp-event-delivery.service.js';
import { SignedEventPublisher } from '../../../src/modules/erp-integration/signed-event-publisher.js';
import { buildLoanBookHarness, customerUser, merchantOf } from '../credit/support/loan-book-harness.js';
import { openIntegrationDatabase } from '../support/database.js';

async function main(): Promise<void> {
  const [phase, ...args] = process.argv.slice(2);
  const database = await openIntegrationDatabase();
  if (!database) throw new Error('Sin base de Core.');
  const { sequelize } = database;
  try {
    if (phase === 'prepare') {
      const partnerId = '930071';
      const harness = await buildLoanBookHarness(sequelize);
      const loan = await harness.createLoan(partnerId);
      console.log(
        JSON.stringify({
          tenantId: harness.tenantId,
          loanId: loan.loanId,
          customerId: loan.customerId,
          partnerProfileId: partnerId,
          installments: loan.installments.map((i) => String(i.id)),
        }),
      );
      return;
    }
    if (phase === 'confirm') {
      const [tenantId, loanId, installmentId, partnerId] = args as [string, string, string, string];
      const harness = await buildLoanBookHarness(sequelize);
      // El harness crea su propio tenant; el aviso se hace sobre el préstamo ya preparado.
      await harness.cleanup();
      const customer = await sequelize.query<{ customer_id: string }>(`SELECT customer_id::text FROM credit.loans WHERE _id = $id`, {
        type: QueryTypes.SELECT,
        bind: { id: loanId },
      });
      const customerId = customer[0]!.customer_id;
      const claim = await harness.claims.submit({
        tenantId,
        customerId,
        body: {
          installmentId,
          amount: '333.33',
          payerReference: 'TRX-E2E',
          contentType: 'image/jpeg',
          storageKey: `files/${tenantId}/${customerId}/payment_proof/${randomUUID()}.jpg`,
          sizeBytes: 1024,
        } as never,
        currentUser: customerUser(customerId),
      });
      await harness.partnerClaims.decide({
        tenantId,
        partnerProfileId: partnerId,
        claimId: claim.claimId,
        body: { verified: true },
        currentUser: merchantOf(partnerId),
      });
      const publisher = new SignedEventPublisher({ url: process.env.ERP_URL!, secret: process.env.ERP_SECRET!, timeoutMs: 10_000 });
      const service = new ErpEventDeliveryService(sequelize, publisher, {
        leaseMs: 60_000,
        maxAttempts: 12,
        retryBaseMs: 1,
        retryMaxMs: 1,
      });
      const passes = [];
      for (let i = 0; i < 3; i += 1) passes.push(await service.deliverPending({ tenantId, limit: 50 }));
      // Nueve reenvíos más de la confirmación: el ACK se «pierde» y la entrega vuelve a la cola.
      for (let i = 0; i < 9; i += 1) {
        await sequelize.query(
          `UPDATE platform_ops.outbound_event_deliveries SET status = 'pending', delivered_at = NULL, next_attempt_at = now()
            WHERE _tenant_id = $tenantId AND aggregate_id = $installmentId AND event_code = 'payment.confirmed'`,
          { bind: { tenantId, installmentId } },
        );
        passes.push(await service.deliverPending({ tenantId, limit: 50 }));
      }
      const rows = await sequelize.query(
        `SELECT event_code, status, attempts, last_http_status FROM platform_ops.outbound_event_deliveries
          WHERE _tenant_id = $tenantId AND aggregate_id = $installmentId ORDER BY aggregate_version`,
        { type: QueryTypes.SELECT, bind: { tenantId, installmentId } },
      );
      console.log(JSON.stringify({ claimId: claim.claimId, passes, deliveries: rows }));
      return;
    }
    throw new Error(`Fase desconocida: ${phase}`);
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
