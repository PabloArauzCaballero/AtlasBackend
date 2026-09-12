/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza materializa la oferta y solicitud de crédito solo para clientes habilitados y con decisiones explicables.
 * @system coordina productos, solicitudes, transiciones y eventos inmutables del ciclo de crédito.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, Transaction } from 'sequelize';
import { CreditApplicationEventModel, CreditApplicationModel, CreditProductModel } from '../../database/models/index.js';

type RepositoryOptions = { transaction?: Transaction };

const OPEN_APPLICATION_STATUSES = ['submitted', 'under_review'];

@Injectable()
export class CreditRepository {
  constructor(
    @InjectModel(CreditProductModel) private readonly productModel: typeof CreditProductModel,
    @InjectModel(CreditApplicationModel) private readonly applicationModel: typeof CreditApplicationModel,
    @InjectModel(CreditApplicationEventModel) private readonly eventModel: typeof CreditApplicationEventModel,
  ) {}

  /** Productos ofrecibles hoy: activos y dentro de su ventana de vigencia. */
  findOfferableProducts(tenantId: string, now: Date): Promise<CreditProductModel[]> {
    return this.productModel.findAll({
      where: {
        tenantId,
        deleted: false,
        status: 'active',
        [Op.and]: [
          { [Op.or]: [{ effectiveFrom: null }, { effectiveFrom: { [Op.lte]: now } }] },
          { [Op.or]: [{ effectiveUntil: null }, { effectiveUntil: { [Op.gt]: now } }] },
        ],
      },
      order: [['minAmount', 'ASC']],
    } as FindOptions);
  }

  findProductById(tenantId: string, productId: string, options: RepositoryOptions = {}): Promise<CreditProductModel | null> {
    return this.productModel.findOne({
      where: { id: productId, tenantId, deleted: false },
      transaction: options.transaction,
    } as FindOptions);
  }

  findProductByCode(tenantId: string, productCode: string): Promise<CreditProductModel | null> {
    return this.productModel.findOne({ where: { tenantId, productCode, deleted: false } } as FindOptions);
  }

  createProduct(values: Record<string, unknown>, options: RepositoryOptions = {}): Promise<CreditProductModel> {
    return this.productModel.create(values as never, { transaction: options.transaction });
  }

  async updateProductStatus(product: CreditProductModel, status: string, now: Date): Promise<CreditProductModel> {
    product.status = status;
    product.updatedAtValue = now;
    return product.save();
  }

  /**
   * Solicitud viva del cliente. La garantía real la da el índice único parcial
   * `ux_credit_applications_open_per_customer`; esta consulta solo permite responder con un error
   * de negocio claro en vez de una violación de constraint.
   */
  findOpenApplication(tenantId: string, customerId: string, options: RepositoryOptions = {}): Promise<CreditApplicationModel | null> {
    return this.applicationModel.findOne({
      where: { tenantId, customerId, deleted: false, status: { [Op.in]: OPEN_APPLICATION_STATUSES } },
      transaction: options.transaction,
    } as FindOptions);
  }

  findApplicationById(tenantId: string, applicationId: string, options: RepositoryOptions = {}): Promise<CreditApplicationModel | null> {
    return this.applicationModel.findOne({
      where: { id: applicationId, tenantId, deleted: false },
      transaction: options.transaction,
    } as FindOptions);
  }

  findApplicationsByCustomer(tenantId: string, customerId: string): Promise<CreditApplicationModel[]> {
    return this.applicationModel.findAll({
      where: { tenantId, customerId, deleted: false },
      order: [['submittedAt', 'DESC']],
      limit: 50,
    } as FindOptions);
  }

  /**
   * Las solicitudes de UN comercio, opcionalmente sólo las que esperan su respuesta.
   *
   * El filtro por comercio va en la consulta y no después, en memoria: es lo que impide que una
   * paginación devuelva las primeras cincuenta del tenant y de ahí se descarten las ajenas —el
   * comercio vería una lista corta sin saber que le faltan las suyas—, y es lo que hace útil el
   * índice parcial de pendientes por comercio.
   */
  findApplicationsByPartner(
    tenantId: string,
    partnerProfileId: string,
    options: { onlyPendingAcceptance?: boolean } = {},
  ): Promise<CreditApplicationModel[]> {
    return this.applicationModel.findAll({
      where: {
        tenantId,
        partnerProfileId,
        deleted: false,
        ...(options.onlyPendingAcceptance ? { businessAcceptance: 'pending' } : {}),
      },
      order: [['submittedAt', 'DESC']],
      limit: 100,
    } as FindOptions);
  }

  createApplication(values: Record<string, unknown>, options: RepositoryOptions): Promise<CreditApplicationModel> {
    return this.applicationModel.create(values as never, { transaction: options.transaction });
  }

  async updateApplicationStatus(
    application: CreditApplicationModel,
    values: { status: string; reasonCode: string; decidedByInternalUserId: string | null; now: Date },
    options: RepositoryOptions,
  ): Promise<CreditApplicationModel> {
    application.status = values.status;
    application.decisionReasonCode = values.reasonCode;
    application.decidedByInternalUserId = values.decidedByInternalUserId;
    application.decidedAt = values.now;
    application.updatedAtValue = values.now;
    return application.save({ transaction: options.transaction });
  }

  createApplicationEvent(
    values: {
      tenantId: string;
      creditApplicationId: string;
      eventType: string;
      previousStatus: string | null;
      newStatus: string | null;
      actorType: string;
      actorInternalUserId: string | null;
      reasonCode: string | null;
      payloadJson: Record<string, unknown> | null;
      notes: string | null;
      happenedAt: Date;
    },
    options: RepositoryOptions,
  ): Promise<CreditApplicationEventModel> {
    return this.eventModel.create({ ...values, createdAtValue: values.happenedAt } as never, { transaction: options.transaction });
  }

  findApplicationEvents(tenantId: string, applicationId: string): Promise<CreditApplicationEventModel[]> {
    return this.eventModel.findAll({
      where: { tenantId, creditApplicationId: applicationId },
      order: [['happenedAt', 'DESC']],
      limit: 100,
    } as FindOptions);
  }
}
