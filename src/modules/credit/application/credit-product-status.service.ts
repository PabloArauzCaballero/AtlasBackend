/**
 * @file Caso de uso: activar, suspender o retirar un producto crediticio, con transición válida y auditoría.
 * @business Lo que se ofrece a los clientes cambia por una decisión con nombre, motivo y fecha, no por una escritura suelta.
 * @system bloquea el producto, valida la transición, escribe el estado y su huella en la misma transacción.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { CreditProductAuditRepository } from '../credit-product-audit.repository.js';
import { CreditRepository } from '../credit.repository.js';
import { canTransitionCreditProduct, CreditProductStatus } from '../domain/credit-product-status.js';

@Injectable()
export class CreditProductStatusService {
  constructor(
    private readonly creditRepository: CreditRepository,
    private readonly audit: CreditProductAuditRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * Antes se ignoraban el motivo y el actor, no se validaba la transición y no quedaba rastro: la
   * pantalla decía «cambio de estado auditado» sobre un `status = x; save()`. Ahora el estado y su
   * registro en la auditoría operativa van juntos o no va ninguno.
   */
  async changeStatus(input: {
    tenantId: string;
    productId: string;
    status: CreditProductStatus;
    reasonCode: string;
    currentUser: AuthenticatedUser;
  }) {
    return this.sequelize.transaction(async (transaction) => {
      const product = await this.creditRepository.findProductById(input.tenantId, input.productId, { transaction, lock: true });
      if (!product) throw new NotFoundException('CREDIT_PRODUCT_NOT_FOUND');

      const previousStatus = product.status;
      if (!canTransitionCreditProduct(previousStatus, input.status)) {
        throw new ConflictException(
          `CREDIT_PRODUCT_STATUS_TRANSITION_NOT_ALLOWED: un producto en «${previousStatus}» no puede pasar a «${input.status}».`,
        );
      }

      const now = new Date();
      await this.creditRepository.updateProductStatus(product, input.status, now, { transaction });
      await this.audit.recordStatusChange(
        {
          tenantId: input.tenantId,
          productId: input.productId,
          productCode: product.productCode ?? null,
          previousStatus,
          newStatus: input.status,
          reasonCode: input.reasonCode,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          occurredAt: now,
        },
        { transaction },
      );
      return {
        productId: input.productId,
        previousStatus,
        status: input.status,
        reasonCode: input.reasonCode,
        changedAt: now.toISOString(),
      };
    });
  }
}
