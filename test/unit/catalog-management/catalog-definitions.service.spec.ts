import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { CatalogDefinitionsService } from '../../../src/modules/catalog-management/application/catalog-definitions.service.js';

/**
 * ATLAS-P12 (continuación de `docs/testing/PLAN_RED_DE_PRUEBAS_ATLAS_P12.md` §9, Fase 1 de
 * `catalog-management`): `upsertDefinitionsPackage` registra observaciones/atributos/features
 * nuevos. El caso más importante de este archivo es el default de seguridad: una definición
 * nueva NUNCA queda habilitada para decisiones de crédito o fraude, ni aprobada legalmente, a
 * menos que el paquete lo pida explícitamente — así se evita que una feature nueva se use en
 * producción antes de pasar por revisión legal/de sesgo.
 */
describe('CatalogDefinitionsService', () => {
  function buildService() {
    const repository = {
      listDefinitions: jest.fn(),
      upsertEventDefinition: jest.fn(),
      upsertObservationDefinition: jest.fn(),
      upsertAttributeDefinition: jest.fn(),
      upsertFeatureDefinition: jest.fn(),
      createAudit: jest.fn(),
      createDataChange: jest.fn(),
    };
    const sequelize = { transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({})) };
    const service = new CatalogDefinitionsService(repository as never, sequelize as never);
    return { service, repository };
  }

  const internalUser = { role: 'internal_operator', internalUserId: 'iu1', platformUserId: 'pu1' } as never;
  const customerUser = { role: 'customer', internalUserId: null, platformUserId: null } as never;
  const context = { tenantId: 't1', ipAddress: null, userAgent: null, idempotencyKey: 'idem-1' };

  function emptyDefinitions() {
    return { events: [], observations: [], attributes: [], features: [] };
  }

  describe('listDefinitions', () => {
    it('rejects a non-internal actor', async () => {
      const { service } = buildService();
      await expect(service.listDefinitions({ query: {} as never, currentUser: customerUser })).rejects.toThrow(ForbiddenException);
    });
  });

  describe('upsertDefinitionsPackage — defaults de seguridad para decisiones de crédito/fraude', () => {
    it('rejects without an idempotency key', async () => {
      const { service } = buildService();
      await expect(
        service.upsertDefinitionsPackage({
          body: { domain: 'd', definitions: emptyDefinitions() } as never,
          currentUser: internalUser,
          context: { ...context, idempotencyKey: undefined },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('a new observation defaults to allowedForCreditDecision: false, allowedForFraudDecision: false, legalReviewStatus: "pending" when not specified', async () => {
      const { service, repository } = buildService();
      await service.upsertDefinitionsPackage({
        body: {
          domain: 'risk',
          definitions: { ...emptyDefinitions(), observations: [{ observationCode: 'o1', observationName: 'O1' }] },
        } as never,
        currentUser: internalUser,
        context,
      });

      const args = (repository.upsertObservationDefinition as jest.Mock).mock.calls[0][0] as {
        allowedForCreditDecision: boolean;
        allowedForFraudDecision: boolean;
        legalReviewStatus: string;
      };
      expect(args).toMatchObject({ allowedForCreditDecision: false, allowedForFraudDecision: false, legalReviewStatus: 'pending' });
    });

    it('the same safe-by-default rule applies to feature definitions, independently', async () => {
      const { service, repository } = buildService();
      await service.upsertDefinitionsPackage({
        body: { domain: 'risk', definitions: { ...emptyDefinitions(), features: [{ featureCode: 'f1', featureName: 'F1' }] } } as never,
        currentUser: internalUser,
        context,
      });

      const args = (repository.upsertFeatureDefinition as jest.Mock).mock.calls[0][0] as {
        allowedForCreditDecision: boolean;
        legalReviewStatus: string;
      };
      expect(args).toMatchObject({ allowedForCreditDecision: false, legalReviewStatus: 'pending' });
    });

    it('an explicit allowedForCreditDecision: true in the input is respected, not overridden by the default', async () => {
      const { service, repository } = buildService();
      await service.upsertDefinitionsPackage({
        body: {
          domain: 'risk',
          definitions: {
            ...emptyDefinitions(),
            features: [{ featureCode: 'f1', featureName: 'F1', allowedForCreditDecision: true, legalReviewStatus: 'approved' }],
          },
        } as never,
        currentUser: internalUser,
        context,
      });

      const args = (repository.upsertFeatureDefinition as jest.Mock).mock.calls[0][0] as {
        allowedForCreditDecision: boolean;
        legalReviewStatus: string;
      };
      expect(args).toMatchObject({ allowedForCreditDecision: true, legalReviewStatus: 'approved' });
    });

    it('counts events/observations/attributes/features independently across a mixed package', async () => {
      const { service, repository } = buildService();
      const result = await service.upsertDefinitionsPackage({
        body: {
          domain: 'risk',
          definitions: {
            events: [{ eventCode: 'e1', eventName: 'E1', targetTables: [], expectedPayloadSchema: {} }],
            observations: [
              { observationCode: 'o1', observationName: 'O1' },
              { observationCode: 'o2', observationName: 'O2' },
            ],
            attributes: [],
            features: [{ featureCode: 'f1', featureName: 'F1' }],
          },
        } as never,
        currentUser: internalUser,
        context,
      });

      expect(result).toMatchObject({ eventsProcessed: 1, observationsProcessed: 2, attributesProcessed: 0, featuresProcessed: 1 });
      expect(repository.upsertAttributeDefinition).not.toHaveBeenCalled();
    });

    it('an event without an explicit eventFamily/sourcePackage falls back to the package domain', async () => {
      const { service, repository } = buildService();
      await service.upsertDefinitionsPackage({
        body: {
          domain: 'risk_scoring',
          definitions: {
            ...emptyDefinitions(),
            events: [{ eventCode: 'e1', eventName: 'E1', targetTables: [], expectedPayloadSchema: {} }],
          },
        } as never,
        currentUser: internalUser,
        context,
      });

      const args = (repository.upsertEventDefinition as jest.Mock).mock.calls[0][0] as { eventFamily: string; sourcePackage: string };
      expect(args).toMatchObject({ eventFamily: 'risk_scoring', sourcePackage: 'risk_scoring' });
    });
  });
});
