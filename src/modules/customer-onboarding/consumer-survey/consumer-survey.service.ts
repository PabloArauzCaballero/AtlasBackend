/**
 * @file Servicio de aplicación: guarda y lee la encuesta de hábitos de un cliente.
 * @business Es la fase 4 del alta; sus respuestas van al riesgo en modo sombra y su completitud cierra la sección `consumer_survey`.
 * @system upsert por (cliente, versión, pregunta) dentro de una transacción; devuelve el estado con lo que falta.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { CustomerConsumerSurveyAnswerModel, OnboardingFlowModel } from '../../../database/models/index.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { CODIGOS_DE_PREGUNTA, MS_MINIMOS_PARA_LEER, PREGUNTAS_DE_HABITOS, VERSION_DE_ENCUESTA } from './consumer-survey.catalog.js';
import type { ConsumerSurveyDto } from './consumer-survey.schemas.js';

export type EstadoDeEncuesta = {
  surveyVersion: string;
  answered: { questionCode: string; answerCode: string | null; answerValue: number | null; answeredInMs: number; answeredAt: string }[];
  missing: string[];
  complete: boolean;
  /** Preguntas contestadas en menos de lo que se tarda en leerlas. Señal para el riesgo, no un rechazo. */
  answeredWithoutReading: string[];
};

@Injectable()
export class ConsumerSurveyService {
  constructor(
    @InjectModel(CustomerConsumerSurveyAnswerModel) private readonly answerModel: typeof CustomerConsumerSurveyAnswerModel,
    @InjectModel(OnboardingFlowModel) private readonly flowModel: typeof OnboardingFlowModel,
    private readonly customersRepository: CustomersRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /** El catálogo que la app pinta. Público para el cliente autenticado; sin `crossCheck`, que es para el analista. */
  catalog(): { surveyVersion: string; questions: Omit<(typeof PREGUNTAS_DE_HABITOS)[number], 'crossCheck'>[] } {
    return {
      surveyVersion: VERSION_DE_ENCUESTA,
      questions: PREGUNTAS_DE_HABITOS.map(({ crossCheck: _omitido, ...pregunta }) => pregunta),
    };
  }

  async save(input: {
    tenantId: string;
    customerId: string;
    body: ConsumerSurveyDto;
    currentUser: AuthenticatedUser;
  }): Promise<EstadoDeEncuesta> {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);
    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const now = new Date();
    await this.sequelize.transaction(async (transaction) => {
      const flow = await this.flowModel.findOne({
        where: { tenantId: input.tenantId, customerId: input.customerId },
        order: [
          ['startedAt', 'DESC'],
          ['id', 'DESC'],
        ],
        transaction,
      });
      for (const respuesta of input.body.answers) {
        const existente = await this.answerModel.findOne({
          where: {
            tenantId: input.tenantId,
            customerId: input.customerId,
            surveyVersion: input.body.surveyVersion,
            questionCode: respuesta.questionCode,
          },
          transaction,
        });
        const valores = {
          answerCode: respuesta.answerCode ?? null,
          answerValue: respuesta.answerValue === undefined ? null : respuesta.answerValue.toFixed(2),
          answeredInMs: respuesta.answeredInMs,
          answeredAt: now,
        };
        if (existente) {
          await existente.update({ ...valores, updatedAtValue: now }, { transaction });
        } else {
          await this.answerModel.create(
            {
              tenantId: input.tenantId,
              customerId: input.customerId,
              onboardingFlowId: flow ? String(flow.id) : null,
              surveyVersion: input.body.surveyVersion,
              questionCode: respuesta.questionCode,
              ...valores,
              createdAtValue: now,
            },
            { transaction },
          );
        }
      }
    });

    return this.status({ tenantId: input.tenantId, customerId: input.customerId, currentUser: input.currentUser });
  }

  async status(input: { tenantId: string; customerId: string; currentUser: AuthenticatedUser }): Promise<EstadoDeEncuesta> {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);
    const filas = await this.answerModel.findAll({
      where: { tenantId: input.tenantId, customerId: input.customerId, surveyVersion: VERSION_DE_ENCUESTA },
      order: [['answeredAt', 'ASC']],
    });
    const contestadas = new Set(filas.map((f) => f.questionCode));
    return {
      surveyVersion: VERSION_DE_ENCUESTA,
      answered: filas.map((f) => ({
        questionCode: f.questionCode,
        answerCode: f.answerCode,
        answerValue: f.answerValue === null ? null : Number(f.answerValue),
        answeredInMs: f.answeredInMs,
        answeredAt: f.answeredAt.toISOString(),
      })),
      missing: CODIGOS_DE_PREGUNTA.filter((c) => !contestadas.has(c)),
      complete: CODIGOS_DE_PREGUNTA.every((c) => contestadas.has(c)),
      answeredWithoutReading: filas.filter((f) => f.answeredInMs < MS_MINIMOS_PARA_LEER).map((f) => f.questionCode),
    };
  }
}
