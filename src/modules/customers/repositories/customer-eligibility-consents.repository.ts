/**
 * @file Puerto de persistencia: hechos de consentimiento que alimentan la habilitación.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system lectura sin escrituras: consentimientos concedidos del cliente y documentos legales obligatorios vigentes del inquilino.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { effectiveAt } from '../../../common/utils/query/effective-window.util.js';
import { ConsentDocumentModel, CustomerConsentModel } from '../../../database/models/index.js';
import type { EligibilityReadOptions } from './customer-eligibility.read-options.js';

@Injectable()
export class CustomerEligibilityConsentsRepository {
  constructor(
    @InjectModel(CustomerConsentModel) private readonly consentModel: typeof CustomerConsentModel,
    @InjectModel(ConsentDocumentModel) private readonly consentDocumentModel: typeof ConsentDocumentModel,
  ) {}

  async findGrantedConsentDocumentIds(tenantId: string, customerId: string, options: EligibilityReadOptions): Promise<string[]> {
    const rows = await this.consentModel.findAll({
      where: { tenantId, customerId, granted: true, revokedAt: null },
      attributes: ['consentDocumentId'],
      transaction: options.transaction,
    } as FindOptions);
    return rows.map((row) => String(row.consentDocumentId)).filter((id) => id !== 'null');
  }

  /**
   * Documentos legales obligatorios del tenant.
   *
   * Se usa la columna ya existente `consent_documents.requires_explicit_action` como marca de
   * obligatoriedad, en vez de inventar una tabla de configuración paralela: es exactamente la
   * semántica que la columna declara y evita dos fuentes de verdad sobre qué hay que aceptar.
   * Sólo los VIGENTES hoy: una versión programada todavía no se puede aceptar, y una relevada ya no.
   */
  async findRequiredConsentDocumentIds(tenantId: string, options: EligibilityReadOptions = {}): Promise<string[]> {
    const rows = await this.consentDocumentModel.findAll({
      where: { tenantId, status: 'published', requiresExplicitAction: true, [Op.and]: effectiveAt() },
      attributes: ['id'],
      transaction: options.transaction,
    } as FindOptions);
    return rows.map((row) => String(row.id));
  }
}
