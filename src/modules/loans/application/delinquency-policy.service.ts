/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza entrega la versión vigente de lo que se le prometió al cliente sobre la mora.
 * @system resuelve la política de mora vigente a una fecha y la proyecta para la app.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { DelinquencyPolicyModel } from '../../../database/models/index.js';

export const DELINQUENCY_POLICY_CODE = 'mora_e_intereses';

/**
 * La política vigente HOY, no la última publicada.
 *
 * Son cosas distintas: una versión puede estar escrita y aprobada con fecha de entrada futura, y
 * enseñarla antes de tiempo sería comprometerse con reglas que todavía no rigen. Se filtra por
 * `effective_from <= hoy` y se toma la más reciente de las que ya entraron.
 */
@Injectable()
export class DelinquencyPolicyService {
  constructor(@InjectModel(DelinquencyPolicyModel) private readonly policyModel: typeof DelinquencyPolicyModel) {}

  async current(tenantId: string, language = 'es', now = new Date()) {
    const today = now.toISOString().slice(0, 10);

    const policy = await this.policyModel.findOne({
      where: {
        tenantId,
        policyCode: DELINQUENCY_POLICY_CODE,
        language,
        status: 'active',
        deleted: false,
        effectiveFrom: { [Op.lte]: today },
        [Op.or]: [{ effectiveUntil: null }, { effectiveUntil: { [Op.gte]: today } }],
      },
      order: [['effectiveFrom', 'DESC']],
    } as FindOptions);

    if (!policy) throw new NotFoundException('DELINQUENCY_POLICY_NOT_PUBLISHED');

    return {
      policyCode: policy.policyCode,
      versionCode: policy.versionCode,
      language: policy.language,
      title: policy.title,
      summary: policy.summary,
      bodyMarkdown: policy.bodyMd,
      /*
       * El origen viaja al cliente. Una app que presenta como ley lo que es política de la casa
       * engaña, aunque sea sin querer, y quien lea la pantalla tiene derecho a saber a qué puede
       * apelar y qué puede negociar.
       */
      source: { kind: policy.sourceKind, reference: policy.sourceReference },
      stages: Array.isArray(policy.stagesJson) ? policy.stagesJson : [],
      effectiveFrom: policy.effectiveFrom,
    };
  }
}
