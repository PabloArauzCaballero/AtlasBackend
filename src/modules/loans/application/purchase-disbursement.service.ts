/**
 * @file Servicio de aplicación: convierte en préstamo cada compra cuyo pago inicial confirmó el comercio.
 * @business Sin esto la compra se quedaba aprobada y pagada a medias para siempre: sin cuotas, sin cartera y sin puntos.
 * @system lo corre el planificador; reutiliza `LoanDisbursementService` con una clave estable por solicitud.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { CreditRepository } from '../../credit/credit.repository.js';
import { LoanDisbursementService } from './loan-disbursement.service.js';

/** Quién desembolsa cuando nadie pulsa un botón: el planificador, sin usuario interno detrás. */
const DESEMBOLSADOR: AuthenticatedUser = { sub: 'purchase-disbursement', role: 'system' };

/** La clave de idempotencia de una compra: la misma en cada pasada, así un reintento nunca crea dos préstamos. */
export function claveDeDesembolso(applicationId: string): string {
  return `purchase-disbursement:${applicationId}`;
}

/**
 * El último paso de una compra a cuotas.
 *
 * El recorrido es: el Motor aprueba, el comercio acepta, el cliente paga el inicial y el comercio lo
 * confirma. Hasta el 2026-10-08 el préstamo sólo nacía con `POST credit-applications/:id/disbursement`,
 * un botón de operaciones que nadie pulsa en una venta de mostrador: la solicitud 4 de TEST quedó
 * aprobada, aceptada y con Bs 720 confirmados, sin préstamo. La app no tenía cuotas que mostrar, la
 * cartera del comercio salía en cero y los puntos no subían.
 *
 * No se dispara desde la confirmación porque `credit` no puede depender de `loans`
 * (`config/architecture/boundaries.json`). Un barrido corto hace lo mismo y además reintenta solo:
 * si un desembolso falla (decisión vencida, cupo), la compra sigue a la vista en la siguiente pasada
 * y queda en el registro con su motivo, en vez de perderse.
 */
@Injectable()
export class PurchaseDisbursementService {
  private readonly logger = new Logger(PurchaseDisbursementService.name);

  constructor(
    private readonly credit: CreditRepository,
    private readonly disbursement: LoanDisbursementService,
  ) {}

  async disburseConfirmedPurchases(input: { tenantId: string; limit: number }) {
    const pendientes = await this.credit.findApplicationsWithConfirmedDownPayment(input);
    const resumen = { candidates: pendientes.length, disbursed: 0, failed: 0 };
    // En serie: cada desembolso toma el cerrojo del cliente para reservar cupo.
    for (const solicitud of pendientes) {
      const applicationId = String(solicitud.id);
      try {
        await this.disbursement.disburse({
          tenantId: input.tenantId,
          applicationId,
          body: {},
          currentUser: DESEMBOLSADOR,
          idempotencyKey: claveDeDesembolso(applicationId),
        });
        resumen.disbursed += 1;
        this.logger.log(`Compra desembolsada: solicitud=${applicationId} cliente=${solicitud.customerId}`);
      } catch (error) {
        resumen.failed += 1;
        this.logger.error(`No se pudo desembolsar la compra ${applicationId}: ${(error as Error).message}`);
      }
    }
    return resumen;
  }
}
