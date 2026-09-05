import { describe, expect, it } from '@jest/globals';
import {
  toAttributeDefinitionRow,
  toEventDefinitionRow,
  toFeatureDefinitionRow,
  toObservationDefinitionRow,
} from '../../../src/modules/catalog-management/application/catalog-definition-rows.mapper.js';

/**
 * El default de seguridad del catálogo de definiciones, ahora verificable por sí solo.
 *
 * Antes estas reglas vivían dentro de un callback de transacción de 147 líneas: comprobarlas exigía
 * montar un doble de Sequelize y espiar las llamadas al repositorio. Son las reglas que impiden que
 * una observación, atributo o feature recién declarada se use para decidir un crédito o marcar un
 * fraude antes de pasar por revisión legal y de sesgo — es decir, exactamente lo que un regulador
 * preguntaría primero.
 *
 * `catalog-definitions.service.spec.ts` sigue cubriendo que el servicio las aplique dentro de la
 * transacción; aquí se fija el contenido de la regla.
 */
describe('catalog-definition-rows.mapper — defaults de seguridad', () => {
  const at = { createdAtValue: new Date('2026-08-06T00:00:00.000Z'), updatedAtValue: new Date('2026-08-06T00:00:00.000Z') };
  const DOMAIN = 'riesgo';

  describe('una definición mínima nunca nace habilitada para decidir', () => {
    it('observación', () => {
      const row = toObservationDefinitionRow({ observationCode: 'obs', observationName: 'Obs' } as never, DOMAIN, at);

      expect(row.allowedForCreditDecision).toBe(false);
      expect(row.allowedForFraudDecision).toBe(false);
      expect(row.legalReviewStatus).toBe('pending');
      expect(row.prohibitedReasonCode).toBeNull();
      expect(row.requiresConsent).toBe(false);
    });

    it('atributo', () => {
      const row = toAttributeDefinitionRow({ attributeCode: 'att', attributeName: 'Att' } as never, DOMAIN, at);

      expect(row.allowedForCreditDecision).toBe(false);
      expect(row.allowedForFraudDecision).toBe(false);
      expect(row.legalReviewStatus).toBe('pending');
      expect(row.isSensitive).toBe(false);
      expect(row.isModelCandidate).toBe(false);
    });

    it('feature', () => {
      const row = toFeatureDefinitionRow({ featureCode: 'feat', featureName: 'Feat' } as never, DOMAIN, at);

      expect(row.allowedForCreditDecision).toBe(false);
      expect(row.allowedForFraudDecision).toBe(false);
      expect(row.legalReviewStatus).toBe('pending');
      expect(row.isModelInput).toBe(false);
      expect(row.isPolicyRuleInput).toBe(false);
    });
  });

  /**
   * `prohibitedReasonCode` se fija a `null` SIEMPRE, ignorando lo que traiga el paquete: marcar algo
   * como prohibido es una decisión de revisión legal, no algo que se declare al registrar la
   * definición. Fijarlo aquí impide que un paquete se autoconceda el estado de "ya revisado".
   */
  it('prohibitedReasonCode no se puede declarar desde el paquete', () => {
    const row = toFeatureDefinitionRow({ featureCode: 'f', featureName: 'F', prohibitedReasonCode: 'ya_revisado' } as never, DOMAIN, at);

    expect(row.prohibitedReasonCode).toBeNull();
  });

  it('un paquete que pide habilitación explícita sí la obtiene', () => {
    const row = toFeatureDefinitionRow(
      { featureCode: 'f', featureName: 'F', allowedForCreditDecision: true, legalReviewStatus: 'approved' } as never,
      DOMAIN,
      at,
    );

    expect(row.allowedForCreditDecision).toBe(true);
    expect(row.legalReviewStatus).toBe('approved');
  });

  it('el dominio del paquete es el respaldo de las agrupaciones sin declarar', () => {
    expect(toEventDefinitionRow({ eventCode: 'e', eventName: 'E', targetTables: [] } as never, DOMAIN, at).eventFamily).toBe(DOMAIN);
    expect(toObservationDefinitionRow({ observationCode: 'o', observationName: 'O' } as never, DOMAIN, at).sourceGroup).toBe(DOMAIN);
    expect(toAttributeDefinitionRow({ attributeCode: 'a', attributeName: 'A' } as never, DOMAIN, at).sourceType).toBe(DOMAIN);
    expect(toFeatureDefinitionRow({ featureCode: 'f', featureName: 'F' } as never, DOMAIN, at).featureFamily).toBe(DOMAIN);
  });

  it('toda definición nueva nace activa y con las marcas de tiempo del paquete', () => {
    const row = toEventDefinitionRow({ eventCode: 'e', eventName: 'E', targetTables: ['t'] } as never, DOMAIN, at);

    expect(row.isActive).toBe(true);
    expect(row.createdAtValue).toBe(at.createdAtValue);
    expect(row.updatedAtValue).toBe(at.updatedAtValue);
  });
});
