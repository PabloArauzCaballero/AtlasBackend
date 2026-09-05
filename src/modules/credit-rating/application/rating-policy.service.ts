/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza califica la deuda y al cliente para medir pérdida esperada y exposición.
 * @system resuelve la matriz vigente y la valida antes de que califique un solo crédito.
 */
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { RatingPolicyVersionModel } from '../../../database/models/index.js';
import { CreditRatingRepository } from '../credit-rating.repository.js';
import { normalizeScale, type RatingBand } from '../domain/rating-scale.js';

/** La política vigente con su escala ya validada: lo único que el motor necesita para calificar. */
export type ResolvedRatingPolicy = {
  policy: RatingPolicyVersionModel;
  bands: RatingBand[];
  /** La mejor banda de la escala. Es donde cae un cliente sin deuda viva. */
  bestBand: RatingBand;
};

@Injectable()
export class RatingPolicyService {
  constructor(private readonly repository: CreditRatingRepository) {}

  /**
   * Resuelve la matriz con la que se va a calificar, o falla diciendo por qué no se puede.
   *
   * Falla en vez de aplicar un default de código, y esa es la decisión central de todo el motor. Una
   * escala por defecto silenciosa produciría previsiones calculadas con umbrales que nadie aprobó,
   * indistinguibles en la base de las calificadas con la política real. El día que alguien lo
   * descubra, la cartera ya está calificada con dos matrices y no hay columna que diga cuál usó cada
   * fila. Un error explícito es recuperable en un minuto: se activa la política. Una previsión
   * inventada no se detecta nunca.
   */
  async resolveActivePolicy(tenantId: string, options: { transaction?: Transaction } = {}): Promise<ResolvedRatingPolicy> {
    const policy = await this.repository.findActivePolicy(tenantId, options);
    if (!policy) {
      throw new UnprocessableEntityException('RATING_POLICY_NOT_ACTIVE');
    }
    return this.loadScale(policy, options);
  }

  /** La política con la que se calificó ANTES: lo que hace reproducible una calificación vieja. */
  async resolvePolicyById(policyVersionId: string, options: { transaction?: Transaction } = {}): Promise<ResolvedRatingPolicy> {
    const policy = await this.repository.findPolicyById(policyVersionId, options);
    if (!policy) throw new UnprocessableEntityException('RATING_POLICY_NOT_FOUND');
    return this.loadScale(policy, options);
  }

  private async loadScale(policy: RatingPolicyVersionModel, options: { transaction?: Transaction }): Promise<ResolvedRatingPolicy> {
    const rows = await this.repository.findBands(policy.id, options);
    const bands: RatingBand[] = rows.map((row) => ({
      grade: row.grade,
      gradeLabel: row.gradeLabel,
      severityRank: row.severityRank,
      minDaysPastDue: row.minDaysPastDue,
      maxDaysPastDue: row.maxDaysPastDue,
      // `NUMERIC` llega como string desde Postgres justamente para no perder precisión; la conversión
      // se hace una sola vez, aquí, y el resto del motor ya trabaja con un número validado.
      provisionRate: Number.parseFloat(String(row.provisionRate)),
    }));

    let ordered: RatingBand[];
    try {
      ordered = normalizeScale(bands);
    } catch (error) {
      // Una escala rota es un fallo de CONFIGURACIÓN, no de la petición: se traduce a un error que
      // nombra la política concreta, porque el operador necesita saber cuál arreglar y no sólo que
      // «algo» falló al calificar.
      throw new UnprocessableEntityException(
        `RATING_POLICY_SCALE_INVALID: ${policy.policyCode}/${policy.versionCode} — ${(error as Error).message}`,
      );
    }

    if (bands.some((band) => !Number.isFinite(band.provisionRate))) {
      throw new UnprocessableEntityException(
        `RATING_POLICY_SCALE_INVALID: ${policy.policyCode}/${policy.versionCode} — previsión no numérica.`,
      );
    }

    return { policy, bands: ordered, bestBand: ordered[0] };
  }
}
