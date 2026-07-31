/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system expone casos de uso de cliente, evaluación de condiciones y transiciones de estado persistidas.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Transaction } from 'sequelize';
import {
  CustomerEligibilityEvaluationModel,
  CustomerModel,
  CustomerStatusEventModel,
  OutboxEventModel,
} from '../../../database/models/index.js';

type RepositoryOptions = { transaction?: Transaction };

/**
 * Persistencia del estado del cliente y de la evidencia de habilitación.
 *
 * Deliberadamente separada de `CustomersRepository`: el estado tiene un único escritor autorizado
 * (`CustomerLifecycleService`), y tenerlo en su propio repositorio hace visible en el grafo de
 * dependencias quién puede tocarlo. Antes, `updateCustomerStatus` vivía en el repositorio de
 * onboarding y cualquier servicio que lo inyectara podía escribir cualquier string.
 */
@Injectable()
export class CustomerLifecycleRepository {
  constructor(
    @InjectModel(CustomerModel) private readonly customerModel: typeof CustomerModel,
    @InjectModel(CustomerStatusEventModel) private readonly statusEventModel: typeof CustomerStatusEventModel,
    @InjectModel(CustomerEligibilityEvaluationModel)
    private readonly evaluationModel: typeof CustomerEligibilityEvaluationModel,
    @InjectModel(OutboxEventModel) private readonly outboxModel: typeof OutboxEventModel,
  ) {}

  /**
   * Evento de dominio de la transición, en la MISMA transacción que el cambio de estado.
   *
   * Patrón outbox: el orquestador de notificaciones lo consume después y avisa al cliente. Escribirlo
   * aquí —y no tras confirmar la transacción— garantiza que no exista un cambio de estado sin su
   * evento, ni un evento de un cambio que terminó revertido. Antes, un cliente observado o rechazado
   * por un analista no se enteraba nunca: no había ni evento ni notificación.
   */
  createTransitionEvent(
    values: { tenantId: string; customerId: string; previousStatus: string; newStatus: string; reasonCode: string; now: Date },
    options: RepositoryOptions,
  ): Promise<OutboxEventModel> {
    return this.outboxModel.create(
      {
        tenantId: values.tenantId,
        aggregateType: 'customer',
        aggregateId: values.customerId,
        eventCode: `customer.lifecycle.${values.newStatus}`,
        eventPayloadJson: {
          previousStatus: values.previousStatus,
          newStatus: values.newStatus,
          reasonCode: values.reasonCode,
        },
        status: 'pending',
        attempts: 0,
        availableAt: values.now,
        processedAt: null,
        lastError: null,
        correlationId: null,
        createdAtValue: values.now,
        updatedAtValue: values.now,
      } as never,
      { transaction: options.transaction },
    );
  }

  /**
   * Relee el cliente con bloqueo de fila dentro de la transacción.
   *
   * Sin esto, dos transiciones concurrentes (por ejemplo, la decisión de un analista y una
   * reevaluación automática disparada por un evento) leen el mismo `previous_status` y la segunda
   * pisa a la primera dejando un historial que no cuadra.
   */
  findForUpdate(tenantId: string, customerId: string, options: RepositoryOptions): Promise<CustomerModel | null> {
    return this.customerModel.findOne({
      where: { id: customerId, tenantId },
      transaction: options.transaction,
      lock: options.transaction ? Transaction.LOCK.UPDATE : undefined,
    } as FindOptions);
  }

  async applyStatus(customer: CustomerModel, values: { newStatus: string; now: Date }, options: RepositoryOptions): Promise<CustomerModel> {
    customer.lifecycleStatus = values.newStatus;
    customer.updatedAtValue = values.now;
    return customer.save({ transaction: options.transaction });
  }

  createStatusEvent(
    values: {
      tenantId: string;
      customerId: string;
      previousStatus: string;
      newStatus: string;
      reasonCode: string;
      changedByType: string;
      changedByInternalUserId: string | null;
      happenedAt: Date;
      notes: string | null;
    },
    options: RepositoryOptions,
  ): Promise<CustomerStatusEventModel> {
    return this.statusEventModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        previousStatus: values.previousStatus,
        newStatus: values.newStatus,
        reasonCode: values.reasonCode,
        changedByType: values.changedByType,
        changedByInternalUserId: values.changedByInternalUserId,
        changedByPlatformUserId: null,
        happenedAt: values.happenedAt,
        notes: values.notes,
        createdAtValue: values.happenedAt,
      },
      { transaction: options.transaction },
    );
  }

  async applyEligibilityCache(
    customer: CustomerModel,
    values: { eligible: boolean; now: Date },
    options: RepositoryOptions,
  ): Promise<void> {
    customer.creditEligibilityStatus = values.eligible ? 'eligible' : 'not_eligible';
    customer.eligibilityEvaluatedAt = values.now;
    customer.updatedAtValue = values.now;
    await customer.save({ transaction: options.transaction });
  }

  createEvaluation(
    values: {
      tenantId: string;
      customerId: string;
      eligible: boolean;
      lifecycleStatus: string;
      ruleVersion: string;
      blockers: unknown;
      factsHash: string;
      evaluatedByType: string;
      evaluatedByInternalUserId: string | null;
      decisionSource: string;
      reasonCode: string | null;
      notes: string | null;
      evaluatedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CustomerEligibilityEvaluationModel> {
    return this.evaluationModel.create(
      {
        tenantId: values.tenantId,
        customerId: values.customerId,
        eligible: values.eligible,
        lifecycleStatus: values.lifecycleStatus,
        ruleVersion: values.ruleVersion,
        blockersJson: values.blockers,
        factsHash: values.factsHash,
        evaluatedByType: values.evaluatedByType,
        evaluatedByInternalUserId: values.evaluatedByInternalUserId,
        decisionSource: values.decisionSource,
        reasonCode: values.reasonCode,
        notes: values.notes,
        evaluatedAt: values.evaluatedAt,
        createdAtValue: values.evaluatedAt,
      },
      { transaction: options.transaction },
    );
  }

  findLatestEvaluation(tenantId: string, customerId: string): Promise<CustomerEligibilityEvaluationModel | null> {
    return this.evaluationModel.findOne({
      where: { tenantId, customerId },
      order: [
        ['evaluatedAt', 'DESC'],
        ['id', 'DESC'],
      ],
    } as FindOptions);
  }
}
