import { describe, expect, it } from '@jest/globals';
import {
  catalogDto,
  contextItemDto,
  dataGovernanceDto,
  definitionDtos,
  riskPolicyDto,
  stagingItemDto,
} from '../../../src/modules/catalog-management/catalog-management.mapper.js';

/** Mappers puros de `catalog-management`: alta densidad de ramas (null-coalescing, filtros anidados). */
describe('catalog-management.mapper', () => {
  it('catalogDto incluye currentVersion sólo cuando se provee', () => {
    const catalog = { id: 1, catalogCode: 'C', catalogName: 'Cat', domain: 'risk', description: null, ownerTeam: 'x', isActive: true };
    expect(catalogDto(catalog as never, null).currentVersion).toBeNull();
    expect(
      catalogDto(catalog as never, { id: 2, versionCode: 'v1', status: 'active', validFrom: null, validUntil: null } as never)
        .currentVersion,
    ).toMatchObject({ catalogVersionId: '2' });
  });

  it('contextItemDto usa defaults (attributes {}, sourceId null) y mapea aliases/riskMappings', () => {
    const item = {
      id: 3,
      itemCode: 'I',
      itemName: 'Item',
      itemType: 't',
      attributesJson: null,
      sourceId: null,
      confidenceScore: null,
      isActive: true,
    };
    const res = contextItemDto(
      item as never,
      [{ id: 10, aliasValue: 'a', aliasType: 't', normalizedAlias: 'a', confidenceScore: null }] as never,
      [
        {
          id: 20,
          riskDimension: 'fraud',
          riskBand: 'high',
          scorePointsSuggested: null,
          reasonCode: 'r',
          explanation: null,
          modelUsage: null,
          validFrom: null,
          validUntil: null,
        },
      ] as never,
    );
    expect(res).toMatchObject({ contextItemId: '3', attributes: {}, sourceId: null });
    expect(res.aliases[0]).toMatchObject({ aliasId: '10' });
    expect(res.riskMappings[0]).toMatchObject({ riskMappingId: '20' });
    expect(contextItemDto({ ...item, sourceId: 5, attributesJson: { a: 1 } } as never, [] as never, [] as never)).toMatchObject({
      sourceId: '5',
      attributes: { a: 1 },
    });
  });

  it('stagingItemDto normaliza catalogId/ingestionJobId null y proposedAttributes default', () => {
    expect(
      stagingItemDto({
        id: 1,
        catalogId: null,
        ingestionJobId: null,
        proposedItemCode: 'x',
        proposedItemName: 'y',
        proposedAttributesJson: null,
        aiSuggested: true,
        reviewStatus: 'pending',
        reviewNotes: null,
      } as never),
    ).toMatchObject({ stagingItemId: '1', catalogId: null, ingestionJobId: null, proposedAttributes: {} });
  });

  it('definitionDtos: events.relatedTables cubre array / objeto->keys / null->[]', () => {
    const ev = (targetTablesJson: unknown) => ({
      id: 1,
      eventCode: 'e',
      eventName: 'E',
      eventFamily: 'f',
      sourcePackage: 'p',
      riskDimension: 'd',
      isHighVolume: false,
      isActive: true,
      ownerTeam: 'o',
      domainCode: 'dc',
      reviewStatus: 'r',
      targetTablesJson,
    });
    const res = definitionDtos({
      observations: [] as never,
      events: [ev(['t1', 't2']), ev({ t3: 1, t4: 2 }), ev(null)] as never,
      attributes: [] as never,
      features: [] as never,
    });
    expect(res.events[0].relatedTables).toEqual(['t1', 't2']);
    expect(res.events[1].relatedTables).toEqual(['t3', 't4']);
    expect(res.events[2].relatedTables).toEqual([]);
  });

  it('riskPolicyDto anida las reglas de cada ruleset por rulesetVersionId', () => {
    const res = riskPolicyDto({
      modelVersions: [
        {
          id: 1,
          modelCode: 'm',
          versionCode: 'v',
          modelType: 't',
          assessmentType: 'a',
          status: 's',
          effectiveFrom: null,
          effectiveUntil: null,
        },
      ] as never,
      rulesetVersions: [
        { id: 9, rulesetCode: 'rs', versionCode: 'v', assessmentType: 'a', status: 's', effectiveFrom: null, effectiveUntil: null },
      ] as never,
      rules: [
        {
          id: 100,
          rulesetVersionId: 9,
          ruleCode: 'R1',
          ruleName: 'n',
          riskDimension: 'd',
          ruleType: 't',
          severity: 's',
          actionCode: 'a',
          reasonCode: 'r',
          isHardStop: false,
        },
        {
          id: 101,
          rulesetVersionId: 99,
          ruleCode: 'OTHER',
          ruleName: 'n',
          riskDimension: 'd',
          ruleType: 't',
          severity: 's',
          actionCode: 'a',
          reasonCode: 'r',
          isHardStop: false,
        },
      ] as never,
      riskSignalSeeds: [] as never,
    });
    expect(res.rulesetVersions[0].rules).toHaveLength(1);
    expect(res.rulesetVersions[0].rules[0]).toMatchObject({ riskPolicyRuleId: '100', ruleCode: 'R1' });
  });

  it('dataGovernanceDto mapea las 6 colecciones', () => {
    const res = dataGovernanceDto({
      privacyPurposes: [{ id: 1, purposeCode: 'p', purposeName: 'P', legalBasis: 'l', requiresExplicitConsent: true }] as never,
      retentionPolicies: [
        { id: 2, policyCode: 'rp', appliesTo: 'x', retentionDays: 30, postRetentionAction: 'delete', legalBasis: 'l' },
      ] as never,
      dataProviders: [
        { id: 3, providerCode: 'dp', providerName: 'DP', providerType: 't', reliabilityScore: null, supportsRetroData: false },
      ] as never,
      classificationPolicies: [
        {
          id: 4,
          classificationCode: 'c',
          classificationName: 'C',
          sensitivityLevel: 'high',
          defaultStorageMode: 'm',
          encryptionRequired: true,
          hashingRequired: false,
          rawStorageAllowed: false,
        },
      ] as never,
      sensitiveFieldRules: [
        {
          id: 5,
          tableName: 't',
          fieldName: 'f',
          classificationCode: 'c',
          storageMode: 'm',
          searchStrategy: 's',
          maskingStrategy: 'm',
          accessPolicyCode: 'a',
        },
      ] as never,
      dataQualityRules: [
        { id: 6, ruleCode: 'q', ruleName: 'Q', targetTable: 't', targetField: 'f', severity: 's', expectedAction: 'a', isActive: true },
      ] as never,
    });
    expect(res.privacyPurposes[0]).toMatchObject({ purposeId: '1' });
    expect(res.dataQualityRules[0]).toMatchObject({ dataQualityRuleId: '6' });
  });
});
