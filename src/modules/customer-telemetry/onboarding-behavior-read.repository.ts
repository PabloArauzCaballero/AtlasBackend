/**
 * @file Puerto de persistencia: lee los eventos de comportamiento de un flujo de alta.
 * @business Esta pieza captura señales de comportamiento y dispositivo necesarias para prevención de fraude y mejora de conversión.
 * @system reúne en una pasada lo que el cálculo del resumen necesita: pasos, campos, toques, permisos y abandonos previos.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import {
  CustomerActionLogModel,
  FormFieldInteractionEventModel,
  OnboardingBehaviorSummaryModel,
  OnboardingFlowModel,
  OnboardingStepEventModel,
  PermissionEventModel,
} from '../../database/models/index.js';
import type { EntradasDelResumen } from './application/onboarding-behavior-summary.calculo.js';

/** Tope de filas por familia: un alta produce unos cientos; esto evita que un flujo desbocado tumbe el cálculo. */
const TOPE = 5000;

@Injectable()
export class OnboardingBehaviorReadRepository {
  constructor(
    @InjectModel(OnboardingFlowModel) private readonly flowModel: typeof OnboardingFlowModel,
    @InjectModel(OnboardingStepEventModel) private readonly stepModel: typeof OnboardingStepEventModel,
    @InjectModel(FormFieldInteractionEventModel) private readonly fieldModel: typeof FormFieldInteractionEventModel,
    @InjectModel(CustomerActionLogModel) private readonly actionModel: typeof CustomerActionLogModel,
    @InjectModel(PermissionEventModel) private readonly permissionModel: typeof PermissionEventModel,
    @InjectModel(OnboardingBehaviorSummaryModel) private readonly summaryModel: typeof OnboardingBehaviorSummaryModel,
  ) {}

  findLatestOnboardingFlow(tenantId: string, customerId: string): Promise<OnboardingFlowModel | null> {
    return this.flowModel.findOne({
      where: { tenantId, customerId },
      order: [
        ['startedAt', 'DESC'],
        ['id', 'DESC'],
      ],
    });
  }

  findLatestSummary(tenantId: string, customerId: string): Promise<OnboardingBehaviorSummaryModel | null> {
    return this.summaryModel.findOne({
      where: { tenantId, customerId },
      order: [
        ['computedAt', 'DESC'],
        ['id', 'DESC'],
      ],
    });
  }

  /**
   * Todo lo que el cálculo necesita del flujo.
   *
   * Los toques (`customer_actions`) no llevan `onboarding_flow_id`, así que se acotan por cliente y
   * por la ventana temporal del flujo: desde que empezó hasta que se cerró, o hasta ahora.
   */
  async entradasDelResumen(tenantId: string, customerId: string, flow: OnboardingFlowModel | null): Promise<EntradasDelResumen> {
    if (!flow) return { pasos: [], campos: [], toques: [], permisos: [], abandonosPrevios: 0 };
    const flowId = String(flow.id);
    const desde = flow.startedAt ?? flow.createdAtValue;
    const hasta = flow.completedAt ?? flow.abandonedAt ?? new Date();

    const [pasos, campos, toques, permisos, abandonosPrevios] = await Promise.all([
      this.stepModel.findAll({
        where: { tenantId, onboardingFlowId: flowId },
        order: [
          ['startedAt', 'ASC'],
          ['id', 'ASC'],
        ],
        limit: TOPE,
      }),
      this.fieldModel.findAll({
        where: { tenantId, onboardingFlowId: flowId },
        order: [
          ['occurredAt', 'ASC'],
          ['id', 'ASC'],
        ],
        limit: TOPE,
      }),
      this.actionModel.findAll({
        where: { tenantId, customerId, eventName: 'tap', occurredAt: { [Op.between]: [desde, hasta] } },
        order: [
          ['occurredAt', 'ASC'],
          ['id', 'ASC'],
        ],
        limit: TOPE,
      }),
      this.permissionModel.findAll({ where: { tenantId, onboardingFlowId: flowId }, limit: TOPE }),
      this.flowModel.count({ where: { tenantId, customerId, completionStatus: 'abandoned', id: { [Op.ne]: flow.id } } }),
    ]);

    return {
      pasos: pasos.map((p) => ({
        stepCode: p.stepCode ?? '',
        eventType: p.eventType ?? '',
        payload: p.payloadJson,
        occurredAt: p.startedAt ?? p.createdAtValue,
      })),
      campos: campos.map((c) => ({
        fieldCode: c.fieldCode ?? '',
        interactionType: c.interactionType ?? '',
        usedCopyPaste: c.usedCopyPaste,
        correctionCount: c.correctionCount,
        focusDurationMs: c.focusDurationMs,
        occurredAt: c.occurredAt ?? c.createdAtValue,
      })),
      toques: toques.map((t) => {
        const payload = (t.actionPayloadJson ?? {}) as Record<string, unknown>;
        return {
          control: typeof payload['control'] === 'string' ? payload['control'] : null,
          screenName: t.screenName,
          rx: typeof payload['rx'] === 'number' ? payload['rx'] : null,
          ry: typeof payload['ry'] === 'number' ? payload['ry'] : null,
          occurredAt: t.occurredAt ?? t.createdAtValue,
        };
      }),
      permisos: permisos.map((p) => ({ granted: p.granted })),
      abandonosPrevios,
    };
  }
}
