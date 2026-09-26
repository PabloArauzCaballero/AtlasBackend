/**
 * @file Puerto de persistencia: los hechos de las dos fases nuevas del alta.
 * @business Esta pieza mantiene la identidad operativa, ciclo de vida y elegibilidad del cliente como fuente de verdad.
 * @system lee qué permisos del teléfono decidió el cliente y qué preguntas de hábitos contestó; nada más.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { CustomerConsentModel, CustomerConsumerSurveyAnswerModel } from '../../../database/models/index.js';
import { VERSION_DE_ENCUESTA } from '../consumer-survey.catalog.js';
import { DEVICE_PERMISSION_PURPOSE_CODES } from '../customer-eligibility.constants.js';
import type { EligibilityReadOptions } from './customer-eligibility.read-options.js';

/**
 * Separado de `CustomerEligibilityRepository` por el gate de tamaño (300 líneas) y porque son dos
 * preguntas nuevas con dos tablas propias: si mañana la encuesta cambia de versión, cambia aquí.
 */
@Injectable()
export class CustomerEligibilityPhasesRepository {
  constructor(
    @InjectModel(CustomerConsentModel) private readonly consentModel: typeof CustomerConsentModel,
    @InjectModel(CustomerConsumerSurveyAnswerModel) private readonly surveyAnswerModel: typeof CustomerConsumerSurveyAnswerModel,
  ) {}

  /**
   * Las finalidades de permisos del teléfono con una decisión, sea cual sea. Decir que no también
   * cierra la sección: lo que se exige es que la persona haya decidido, no que haya concedido.
   */
  async findDecidedDevicePermissionPurposes(tenantId: string, customerId: string, options: EligibilityReadOptions = {}): Promise<string[]> {
    const rows = await this.consentModel.findAll({
      where: { tenantId, customerId, purposeCode: { [Op.in]: [...DEVICE_PERMISSION_PURPOSE_CODES] } },
      attributes: ['purposeCode'],
      transaction: options.transaction,
    } as FindOptions);
    return [...new Set(rows.map((row) => String(row.purposeCode)))];
  }

  async findAnsweredSurveyQuestionCodes(tenantId: string, customerId: string, options: EligibilityReadOptions = {}): Promise<string[]> {
    const rows = await this.surveyAnswerModel.findAll({
      where: { tenantId, customerId, surveyVersion: VERSION_DE_ENCUESTA },
      attributes: ['questionCode'],
      transaction: options.transaction,
    } as FindOptions);
    return [...new Set(rows.map((row) => String(row.questionCode)))];
  }
}
