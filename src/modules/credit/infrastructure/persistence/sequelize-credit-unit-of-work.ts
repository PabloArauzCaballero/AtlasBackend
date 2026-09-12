/**
 * @file Adaptador Sequelize de la unidad de trabajo de Crédito (AT-015).
 * @business Es el único sitio de Crédito que sabe que existe una transacción; la admisión escribe a
 *   través de la sesión y la atomicidad la garantiza este adaptador.
 * @system Liga `CreditRepository` y `CustomerEligibilityService` a la transacción abierta por
 *   `SequelizeUnitOfWork`. La sesión no expone `transaction` ni ningún método que la reciba.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import type { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { OutboxEventModel } from '../../../../database/models/index.js';
import { SequelizeOutboxWriter } from '../../../../platform/events/sequelize-outbox-writer.js';
import { SequelizeUnitOfWork } from '../../../../platform/persistence/local-unit-of-work.js';
import { CustomerEligibilityService } from '../../../customers/application/customer-eligibility.service.js';
import { CustomerEligibilityRepository } from '../../../customers/repositories/customer-eligibility.repository.js';
import { CreditRepository } from '../../credit.repository.js';
import type { CreditUnitOfWork, CreditWorkSession } from '../../application/ports/credit-unit-of-work.port.js';

@Injectable()
export class SequelizeCreditUnitOfWork extends SequelizeUnitOfWork<CreditWorkSession> implements CreditUnitOfWork {
  constructor(
    @InjectConnection() sequelize: Sequelize,
    private readonly creditRepository: CreditRepository,
    private readonly eligibilityService: CustomerEligibilityService,
    private readonly eligibilityRepository: CustomerEligibilityRepository,
  ) {
    super(sequelize);
  }

  protected bind(transaction: Transaction): CreditWorkSession {
    return {
      applications: {
        findProductById: (tenantId, productId) => this.creditRepository.findProductById(tenantId, productId, { transaction }),
        findOpenApplication: (tenantId, customerId) => this.creditRepository.findOpenApplication(tenantId, customerId, { transaction }),
        createApplication: (values) => this.creditRepository.createApplication(values, { transaction }),
        createApplicationEvent: (values) => this.creditRepository.createApplicationEvent(values, { transaction }),
      },
      eligibility: {
        lockCustomer: (tenantId, customerId) => this.eligibilityService.lockCustomerForDecision(tenantId, customerId, transaction),
        loadFacts: (tenantId, customerId) => this.eligibilityRepository.loadFacts(tenantId, customerId, { transaction }),
        evaluateAndRecord: (input) => this.eligibilityService.evaluateAndRecord({ ...input, transaction }),
      },
      outbox: new SequelizeOutboxWriter(OutboxEventModel, transaction),
    };
  }
}
