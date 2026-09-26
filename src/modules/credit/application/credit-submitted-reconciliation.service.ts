/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Ninguna solicitud de crédito se queda esperando una decisión que nadie va a tomar.
 * @system barre las solicitudes `submitted` atascadas y vuelve a decidirlas por el mismo camino que el submit.
 */
import { Injectable, Logger } from '@nestjs/common';
import { CreditRepository } from '../credit.repository.js';
import { CreditUnderwritingService } from './credit-underwriting.service.js';

export type SubmittedReconciliationResult = {
  scanned: number;
  /** Las que dejaron de estar `submitted`: decididas por el motor o derivadas a revisión. */
  resolved: number;
  /** Las que siguen sin resolverse porque volver a decidirlas también falló. Se reintentan en la próxima pasada. */
  failed: number;
};

/**
 * Recoge las solicitudes que se quedaron en `submitted` (C-2, plan 2026-09-25).
 *
 * ## Por qué existe
 *
 * El submit confirma la solicitud y DESPUÉS le pregunta al motor (ver `CreditUnderwritingService`):
 * es E/S de red y no cabe dentro de la transacción. Si el proceso muere entre las dos cosas —un
 * despliegue, un OOM, un reinicio del contenedor—, la solicitud queda creada y sin decidir. Y
 * `submitted` cuenta como abierta para `ux_credit_applications_open_per_customer`: el cliente no
 * puede pedir otro crédito, y ningún job miraba esas filas. Medible en una base viva: una fila así
 * bloquea al cliente para siempre.
 *
 * ## Qué hace
 *
 * Vuelve a llamar a `CreditUnderwritingService.underwrite`, que es EL mismo camino del submit: el
 * motor deduplica por la clave de idempotencia de la solicitud (misma ejecución, no una nueva), y si
 * el motor sigue sin responder la solicitud pasa a `under_review` con su caso —revisión humana con
 * motivo, nunca rechazo—. Salir de `submitted` es el objetivo; cómo se decida es cosa de la política.
 *
 * La gracia (por defecto 15 minutos) existe para no pisar al submit que todavía está esperando al
 * motor: una solicitud recién creada está `submitted` legítimamente.
 */
@Injectable()
export class CreditSubmittedReconciliationService {
  private readonly logger = new Logger(CreditSubmittedReconciliationService.name);

  constructor(
    private readonly credit: CreditRepository,
    private readonly underwriting: CreditUnderwritingService,
  ) {}

  async reconcile(input: { tenantId: string; graceMinutes: number; limit: number; now?: Date }): Promise<SubmittedReconciliationResult> {
    const now = input.now ?? new Date();
    const olderThan = new Date(now.getTime() - input.graceMinutes * 60_000);
    const stale = await this.credit.findStaleSubmittedApplications(input.tenantId, olderThan, input.limit);

    let resolved = 0;
    let failed = 0;
    // En serie a propósito: cada una es una llamada al motor, y un lote en paralelo convertiría un
    // atasco en una tormenta de peticiones contra el mismo sistema que probablemente lo causó.
    for (const application of stale) {
      try {
        const product = await this.credit.findProductById(input.tenantId, String(application.creditProductId));
        const result = await this.underwriting.underwrite({
          tenantId: input.tenantId,
          applicationId: String(application.id),
          customerId: String(application.customerId),
          applicationCode: application.applicationCode,
          requestedAmount: application.requestedAmount,
          requestedTermMonths: application.requestedTermMonths,
          currencyCode: application.currencyCode,
          productCode: product?.productCode ?? null,
          purposeCode: application.purposeCode,
        });
        if (result.status === 'submitted' || result.status === 'unknown') failed += 1;
        else resolved += 1;
      } catch (error) {
        // Una fila que falla no puede impedir que se recojan las demás: se cuenta y se reintenta
        // en la próxima pasada, con el error en el log para quien tenga que mirar por qué.
        failed += 1;
        this.logger.error(
          `No se pudo recoger la solicitud ${application.applicationCode} atascada en submitted: ${(error as Error).message}`,
        );
      }
    }

    if (stale.length > 0) {
      this.logger.warn(
        `Solicitudes de crédito atascadas en submitted: ${stale.length} (recogidas ${resolved}, sin resolver ${failed}) en el tenant ${input.tenantId}.`,
      );
    }
    return { scanned: stale.length, resolved, failed };
  }
}
