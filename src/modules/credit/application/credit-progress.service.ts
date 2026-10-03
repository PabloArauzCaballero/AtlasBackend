/**
 * @file Caso de uso: el nivel de un cliente y su evolución.
 * @business Responde «¿en qué nivel estoy, cuánto me falta para el siguiente y qué hago para subir?». Es lo que convierte el puntaje en algo que se mueve con la conducta.
 * @system compone `PaymentCapacityService` (nivel, desde la base de datos) con el historial de versiones de la línea; no llama al motor.
 */
import { Injectable } from '@nestjs/common';
import { buildRelationshipProgress } from '../domain/relationship-progress.js';
import { CreditLineService } from './credit-line.service.js';
import { PaymentCapacityService } from './payment-capacity.service.js';

/** Cuántas versiones de la línea se enseñan en la evolución. */
const HISTORY_LIMIT = 12;

@Injectable()
export class CreditProgressService {
  constructor(
    private readonly capacity: PaymentCapacityService,
    private readonly lines: CreditLineService,
  ) {}

  /**
   * El nivel NO depende de que exista una línea de crédito calculada.
   *
   * Sale de la base de datos —antigüedad, pagos, compras cerradas, identidad—, no del motor. Así quien todavía
   * no tiene línea (porque el motor aún no decidió, o el extracto está en revisión) ve igual dónde está y qué
   * le falta, en vez de una pantalla vacía que parece un fallo.
   */
  async get(tenantId: string, customerId: string) {
    const current = await this.lines.current(tenantId, customerId);
    const [{ assessment, relationship }, history] = await Promise.all([
      this.capacity.assessDetailed({
        tenantId,
        customerId,
        declaredMonthlyIncome: null,
        currentLimit: current ? Number(current.approvedLimit) : null,
      }),
      this.lines.history(tenantId, customerId, HISTORY_LIMIT),
    ]);

    return {
      customerId,
      hasCreditLine: current !== null,
      ...buildRelationshipProgress(assessment, relationship),
      signals: {
        tenureMonths: relationship.tenureMonths,
        loansSettled: relationship.loansSettled,
        loansActive: relationship.loansActive,
        onTimeRatio: relationship.onTimeRatio,
        kycComplete: relationship.kycComplete,
      },
      // De la más reciente a la más antigua, como el resto del historial de la línea.
      history: history.map((line) => ({
        validFrom: line.validFrom,
        trigger: line.calculationTrigger,
        scoring: line.scoring,
        approvedLimit: Number(line.approvedLimit),
        relationshipScore: line.relationshipScore,
        relationshipTier: line.relationshipTier,
      })),
    };
  }
}
