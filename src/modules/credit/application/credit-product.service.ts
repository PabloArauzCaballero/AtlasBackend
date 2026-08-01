/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza materializa la oferta y solicitud de crédito solo para clientes habilitados y con decisiones explicables.
 * @system coordina productos, solicitudes, transiciones y eventos inmutables del ciclo de crédito.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { CustomerEligibilityService } from '../../customers/application/customer-eligibility.service.js';
import { CustomerEligibilityRepository } from '../../customers/repositories/customer-eligibility.repository.js';
import { qualifiesForProduct } from './credit-product-eligibility.js';
import { CreateCreditProductDto } from '../credit.schemas.js';
import { CreditRepository } from '../credit.repository.js';

/**
 * Catálogo de productos crediticios.
 *
 * La lectura del cliente lleva siempre su propia elegibilidad adjunta: el frontend no tiene que
 * cruzar dos endpoints ni decidir por su cuenta si puede ofrecer el botón de solicitud, y no puede
 * quedar mostrando productos "disponibles" para alguien que no lo está.
 */
@Injectable()
export class CreditProductService {
  constructor(
    private readonly creditRepository: CreditRepository,
    private readonly eligibilityService: CustomerEligibilityService,
    private readonly eligibilityRepository: CustomerEligibilityRepository,
  ) {}

  /** Catálogo para el cliente, con su elegibilidad vigente. */
  async listForCustomer(input: { tenantId: string; customerId: string; currentUser: AuthenticatedUser }) {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);

    const [products, assessment, facts] = await Promise.all([
      this.creditRepository.findOfferableProducts(input.tenantId, new Date()),
      this.eligibilityService.evaluate(input.tenantId, input.customerId),
      this.eligibilityRepository.loadFacts(input.tenantId, input.customerId),
    ]);

    return {
      customerId: input.customerId,
      eligible: assessment.eligible,
      blockers: assessment.blockers,
      products: products.map((product) => ({
        productId: String(product.id),
        productCode: product.productCode,
        productName: product.productName,
        description: product.description,
        currencyCode: product.currencyCode,
        minAmount: product.minAmount,
        maxAmount: product.maxAmount,
        minTermMonths: product.minTermMonths,
        maxTermMonths: product.maxTermMonths,
        annualInterestRate: product.annualInterestRate,
        requiresManualReview: product.requiresManualReview,
        minMonthlyIncome: product.minMonthlyIncome,
        // Dos capas: la habilitación general del cliente Y los requisitos de ESTE producto. Un
        // cliente habilitado puede no alcanzar el ingreso mínimo de un producto y sí el de otro, y
        // el catálogo tiene que reflejar esa diferencia en vez de ofrecerlo todo por igual.
        canApply: assessment.eligible && qualifiesForProduct(product, facts.financialAttributeValues),
      })),
    };
  }

  /** Catálogo completo para operaciones, incluidos borradores y productos retirados. */
  async listForOperations(tenantId: string) {
    const products = await this.creditRepository.findOfferableProducts(tenantId, new Date());
    return { products };
  }

  async createProduct(input: { tenantId: string; body: CreateCreditProductDto; currentUser: AuthenticatedUser }) {
    const existing = await this.creditRepository.findProductByCode(input.tenantId, input.body.productCode);
    if (existing) throw new ConflictException('CREDIT_PRODUCT_CODE_ALREADY_EXISTS');

    const now = new Date();
    const product = await this.creditRepository.createProduct({
      tenantId: input.tenantId,
      productCode: input.body.productCode,
      productName: input.body.productName,
      description: input.body.description ?? null,
      currencyCode: input.body.currencyCode,
      minAmount: input.body.minAmount.toFixed(2),
      maxAmount: input.body.maxAmount.toFixed(2),
      minTermMonths: input.body.minTermMonths,
      maxTermMonths: input.body.maxTermMonths,
      annualInterestRate: input.body.annualInterestRate?.toFixed(4) ?? null,
      minMonthlyIncome: input.body.minMonthlyIncome?.toFixed(2) ?? null,
      requiresManualReview: input.body.requiresManualReview,
      // Nace en `draft`: activarlo es una decisión aparte y auditable, no un efecto de crearlo.
      status: 'draft',
      effectiveFrom: input.body.effectiveFrom ? new Date(input.body.effectiveFrom) : null,
      effectiveUntil: input.body.effectiveUntil ? new Date(input.body.effectiveUntil) : null,
      createdByInternalUserId: input.currentUser.internalUserId ?? null,
      createdAtValue: now,
      updatedAtValue: now,
      deleted: false,
    });

    return { productId: String(product.id), productCode: product.productCode, status: product.status };
  }

  async changeStatus(input: { tenantId: string; productId: string; status: string; currentUser: AuthenticatedUser }) {
    const product = await this.creditRepository.findProductById(input.tenantId, input.productId);
    if (!product) throw new NotFoundException('CREDIT_PRODUCT_NOT_FOUND');

    const previousStatus = product.status;
    await this.creditRepository.updateProductStatus(product, input.status, new Date());
    return { productId: input.productId, previousStatus, status: input.status };
  }
}
