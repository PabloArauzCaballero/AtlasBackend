/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { CustomerModel } from '../../../database/models/index.js';
import { CustomerLifecycleStatus, canTransition, normalizeLifecycleStatus } from '../customer-lifecycle.constants.js';
import { CustomerLifecycleRepository } from '../repositories/customer-lifecycle.repository.js';

export type LifecycleTransitionInput = {
  tenantId: string;
  customerId: string;
  toStatus: CustomerLifecycleStatus;
  reasonCode: string;
  changedByType: string;
  changedByInternalUserId?: string | null;
  notes?: string | null;
  transaction: Transaction;
};

export type LifecycleTransitionResult = {
  customer: CustomerModel;
  previousStatus: CustomerLifecycleStatus;
  newStatus: CustomerLifecycleStatus;
  changed: boolean;
};

/**
 * Único componente autorizado a escribir `customers.lifecycle_status`.
 *
 * Resuelve tres defectos concretos del código anterior:
 *
 *   1. `OperationsService.decideManualReviewCase` insertaba el evento de historial y NUNCA
 *      actualizaba el estado del cliente. El historial decía "aprobado" y el cliente seguía en
 *      `pending_identity_review`.
 *   2. Ese mismo evento se escribía con `previous_status: null`, rompiendo la reconstrucción de la
 *      cadena de estados justo en el punto donde interviene una persona.
 *   3. No había validación de transiciones: cualquier string de 40 caracteres era un estado válido.
 *
 * Aquí estado y evento se escriben SIEMPRE en la misma transacción, con el estado anterior leído
 * bajo bloqueo de fila, y toda transición ilegal se rechaza con `INVALID_STATUS_TRANSITION`.
 */
@Injectable()
export class CustomerLifecycleService {
  private readonly logger = new Logger(CustomerLifecycleService.name);

  constructor(private readonly lifecycleRepository: CustomerLifecycleRepository) {}

  /**
   * Aplica una transición validada.
   *
   * Si el estado destino coincide con el actual, no escribe ni estado ni evento y devuelve
   * `changed: false`. Esto vuelve idempotentes los reintentos (misma clave de idempotencia, misma
   * decisión repetida) sin ensuciar el historial con eventos que no representan un cambio real.
   */
  async transition(input: LifecycleTransitionInput): Promise<LifecycleTransitionResult> {
    const customer = await this.lifecycleRepository.findForUpdate(input.tenantId, input.customerId, {
      transaction: input.transaction,
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const previousStatus = normalizeLifecycleStatus(customer.lifecycleStatus);

    if (previousStatus === input.toStatus) {
      return { customer, previousStatus, newStatus: input.toStatus, changed: false };
    }

    if (!canTransition(previousStatus, input.toStatus)) {
      throw new UnprocessableEntityException(`INVALID_STATUS_TRANSITION: ${previousStatus} -> ${input.toStatus}`);
    }

    const now = new Date();
    await this.lifecycleRepository.applyStatus(customer, { newStatus: input.toStatus, now }, { transaction: input.transaction });
    await this.lifecycleRepository.createStatusEvent(
      {
        tenantId: input.tenantId,
        customerId: input.customerId,
        previousStatus,
        newStatus: input.toStatus,
        reasonCode: input.reasonCode,
        changedByType: input.changedByType,
        changedByInternalUserId: input.changedByInternalUserId ?? null,
        happenedAt: now,
        notes: input.notes ?? null,
      },
      { transaction: input.transaction },
    );
    await this.lifecycleRepository.createTransitionEvent(
      {
        tenantId: input.tenantId,
        customerId: input.customerId,
        previousStatus,
        newStatus: input.toStatus,
        reasonCode: input.reasonCode,
        now,
      },
      { transaction: input.transaction },
    );

    return { customer, previousStatus, newStatus: input.toStatus, changed: true };
  }

  /**
   * Avance "de mejor esfuerzo" para los pasos del onboarding.
   *
   * Los servicios de paquete (identidad, dirección, perfil) quieren empujar al cliente hacia
   * adelante, pero no deben fallar por ello: si el cliente ya está en `under_review` porque un
   * analista lo movió, reenviar la dirección no puede reventar con un 422. Se registra la
   * transición descartada y se continúa — el paso de negocio sí se persiste.
   */
  async advance(input: LifecycleTransitionInput): Promise<LifecycleTransitionResult | null> {
    try {
      return await this.transition(input);
    } catch (error) {
      if (error instanceof UnprocessableEntityException) {
        this.logger.debug(`Transición de avance descartada para el cliente ${input.customerId} hacia ${input.toStatus}: ${error.message}`);
        return null;
      }
      throw error;
    }
  }
}
