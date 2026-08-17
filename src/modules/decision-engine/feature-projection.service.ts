/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza traslada la decisión de crédito a una política versionada, aprobada y auditable.
 * @system proyecta el feature store del core como variables de entrada del motor, con su gobierno intacto.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { FeatureDefinitionModel, FeatureValueModel } from '../../database/models/index.js';

export type ProjectedFeatures = {
  variables: Record<string, unknown>;
  /** Qué se envió y de dónde salió: la evidencia de con qué información se decidió. */
  lineage: Array<{ featureCode: string; featureValueId: string; derivationVersion: string | null }>;
  /** Declaradas pero fuera del catálogo permitido. Se informan, no se envían en silencio. */
  excluded: Array<{ featureCode: string; reason: string }>;
};

@Injectable()
export class FeatureProjectionService {
  private readonly logger = new Logger(FeatureProjectionService.name);

  constructor(
    @InjectModel(FeatureDefinitionModel) private readonly definitionModel: typeof FeatureDefinitionModel,
    @InjectModel(FeatureValueModel) private readonly valueModel: typeof FeatureValueModel,
  ) {}

  /**
   * Convierte lo que el core sabe del cliente en las variables que el motor espera.
   *
   * Este método es el puente que faltaba. El core lleva años acumulando un feature store con
   * linaje, ventanas de validez y clasificación de datos; el motor resolvía sus variables contra
   * sistemas externos y no contra él. El resultado era que la mejor información disponible sobre un
   * cliente no llegaba a la decisión que la necesitaba.
   *
   * El gobierno del catálogo se respeta ENTERO y no se reinterpreta aquí:
   *
   * - `allowed_for_credit_decision = false` no se envía. Puede ser una variable perfectamente útil y
   *   aun así prohibida —edad, género, código postal—: son exactamente las que la normativa de
   *   crédito justo impide usar al decidir, y el motor las guardaría como entrada de la decisión.
   * - `legal_review_status` que no sea aprobado tampoco viaja: una variable sin revisar es una
   *   variable cuyo uso nadie ha autorizado todavía.
   * - Lo excluido se DEVUELVE en `excluded`, no se descarta callando. Un filtro silencioso se lee
   *   como «no había dato», y quien depura una decisión rara necesita distinguir las dos cosas.
   */
  async projectForCustomer(tenantId: string, customerId: string, asOf: Date): Promise<ProjectedFeatures> {
    // El catálogo de features es GLOBAL: define qué significa cada variable y qué se puede usar al
    // decidir. Lo que está por tenant son los valores, que es donde vive el dato del cliente.
    const definitions = await this.definitionModel.findAll({ where: { isActive: true } } as FindOptions);

    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    const values = await this.valueModel.findAll({
      where: {
        tenantId,
        customerId,
        featureDefinitionId: { [Op.in]: [...byId.keys()] },
        [Op.and]: [
          { [Op.or]: [{ validFrom: null }, { validFrom: { [Op.lte]: asOf } }] },
          { [Op.or]: [{ validUntil: null }, { validUntil: { [Op.gt]: asOf } }] },
        ],
      },
      order: [['createdAtValue', 'DESC']],
    } as FindOptions);

    const variables: Record<string, unknown> = {};
    const lineage: ProjectedFeatures['lineage'] = [];
    const excluded: ProjectedFeatures['excluded'] = [];
    const seen = new Set<string>();

    for (const value of values) {
      const definition = value.featureDefinitionId ? byId.get(value.featureDefinitionId) : undefined;
      if (!definition?.featureCode) continue;
      // Ordenado por fecha descendente: la primera aparición es la vigente.
      if (seen.has(definition.featureCode)) continue;
      seen.add(definition.featureCode);

      const blocked = this.blockedReason(definition);
      if (blocked) {
        excluded.push({ featureCode: definition.featureCode, reason: blocked });
        continue;
      }

      variables[definition.featureCode] = this.readValue(value);
      lineage.push({
        featureCode: definition.featureCode,
        featureValueId: value.id,
        derivationVersion: value.derivationVersion ?? null,
      });
    }

    if (excluded.length > 0) {
      this.logger.debug(`Cliente ${customerId}: ${excluded.length} features fuera del catálogo permitido.`);
    }
    return { variables, lineage, excluded };
  }

  private blockedReason(definition: FeatureDefinitionModel): string | null {
    if (definition.allowedForCreditDecision === false) {
      return definition.prohibitedReasonCode ?? 'NOT_ALLOWED_FOR_CREDIT_DECISION';
    }
    if (definition.legalReviewStatus && definition.legalReviewStatus !== 'approved') {
      return `LEGAL_REVIEW_${definition.legalReviewStatus.toUpperCase()}`;
    }
    return null;
  }

  /**
   * Un valor por fila, en la columna de su tipo.
   *
   * El orden importa: `value_boolean` se comprueba antes que el número porque un `false` es un dato
   * y no una ausencia, y comprobar por veracidad lo convertiría en «no hay valor».
   */
  private readValue(value: FeatureValueModel): unknown {
    if (value.valueBoolean !== null && value.valueBoolean !== undefined) return value.valueBoolean;
    if (value.valueNumber !== null && value.valueNumber !== undefined) return Number(value.valueNumber);
    if (value.valueText !== null && value.valueText !== undefined) return value.valueText;
    return value.valueJson ?? null;
  }
}
