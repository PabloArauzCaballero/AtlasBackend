/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Un producto activo por encima del tope de usura es un incidente real (DEMO-MICRO al 32 %).
 * @system audita el catálogo activo contra `USURY_CAP_RATE` al arrancar, sin tumbar el proceso.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { CreditProductModel } from '../../../database/models/index.js';
import { env } from '../../../config/env.js';

/**
 * Frente 3A (plan `_plan-motor-decisiones-tasa-2026-09-25`, punto 5, último guión): el desembolso ya
 * clampea al tope de usura, así que ningún crédito NUEVO puede salir por encima. Lo que este chequeo
 * cubre es la otra mitad — un producto del CATÁLOGO que ya lo viola y que nadie mira hasta que
 * alguien lo desembolsa. El plan cita un caso real: `DEMO-MICRO` publicado al 32 %, sobre el 24 %
 * legal.
 *
 * Recorre TODOS los tenants a propósito: es una auditoría del catálogo, no una operación de un
 * inquilino, y el arranque no tiene uno propio con el que filtrar.
 *
 * Sólo AVISA (log warn) y no tumba el arranque, por el mismo criterio que
 * `ExternalProviderRegistryService.reportBlockedProviders`: un backend de crédito tiene que seguir
 * sirviendo login, cobros y consultas aunque su catálogo tenga un producto mal configurado — la
 * respuesta correcta es que ese producto específico no pueda desembolsarse por encima del tope (ya
 * lo hace `loan-disbursement.service.ts`), no que nadie pueda operar.
 */
@Injectable()
export class CreditProductUsuryCheckService implements OnModuleInit {
  private readonly logger = new Logger(CreditProductUsuryCheckService.name);

  constructor(@InjectModel(CreditProductModel) private readonly productModel: typeof CreditProductModel) {}

  async onModuleInit(): Promise<void> {
    await this.warnAboveUsuryCap();
  }

  private async warnAboveUsuryCap(): Promise<void> {
    try {
      const usuryCapPercent = env.USURY_CAP_RATE * 100;
      const products = await this.productModel.findAll({ where: { deleted: false, status: 'active' } as never });
      for (const product of products) {
        const rate = product.annualInterestRate === null ? null : Number(product.annualInterestRate);
        if (rate !== null && rate > usuryCapPercent) {
          this.logger.warn(
            `El producto ${product.productCode} (tenant ${product.tenantId}) está activo con annual_interest_rate=${rate}%, por ` +
              `encima del tope de usura configurado (USURY_CAP_RATE=${env.USURY_CAP_RATE} → ${usuryCapPercent}%). El desembolso lo ` +
              'clampea igual, pero el catálogo publicado no debería tenerlo así.',
          );
        }
      }
    } catch (error) {
      // Ver JSDoc de la clase: esto NUNCA tumba el arranque. Un catálogo que no se pudo auditar
      // todavía sigue siendo mejor que un backend que no arranca.
      this.logger.warn(`No se pudo auditar el catálogo de productos contra el tope de usura al arrancar: ${(error as Error).message}`);
    }
  }
}
