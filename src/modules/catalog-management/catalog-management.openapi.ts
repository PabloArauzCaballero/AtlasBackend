import type { SchemaObject } from '../../common/openapi/zod-to-schema.util.js';

const nullableString = { type: 'string', nullable: true } satisfies SchemaObject;
const positiveId = { type: 'string', pattern: '^[1-9][0-9]*$' } satisfies SchemaObject;
const dateOnly = { type: 'string', format: 'date', nullable: true } satisfies SchemaObject;

const catalogVersionSummarySchema = {
  type: 'object',
  properties: {
    catalogVersionId: positiveId,
    versionCode: { type: 'string' },
    status: { type: 'string', enum: ['draft', 'pending_approval', 'approved', 'published', 'retired', 'rejected'] },
    validFrom: dateOnly,
    validUntil: dateOnly,
  },
  required: ['catalogVersionId', 'versionCode', 'status', 'validFrom', 'validUntil'],
} satisfies SchemaObject;

export const catalogSchema = {
  type: 'object',
  description: 'Catálogo de contexto usado para normalizar señales antes de una evaluación del motor de decisión.',
  properties: {
    catalogId: positiveId,
    catalogCode: { type: 'string' },
    catalogName: { type: 'string' },
    domain: nullableString,
    description: nullableString,
    ownerTeam: nullableString,
    isActive: { type: 'boolean' },
    currentVersion: { ...catalogVersionSummarySchema, nullable: true },
  },
  required: ['catalogId', 'catalogCode', 'catalogName', 'domain', 'description', 'ownerTeam', 'isActive', 'currentVersion'],
} satisfies SchemaObject;

const aliasSchema = {
  type: 'object',
  properties: {
    aliasId: positiveId,
    aliasValue: { type: 'string' },
    aliasType: { type: 'string' },
    normalizedAlias: { type: 'string' },
    confidenceScore: nullableString,
  },
} satisfies SchemaObject;

const riskMappingSchema = {
  type: 'object',
  description: 'Interpretación de un valor de catálogo para scoring, reglas o explicabilidad.',
  properties: {
    riskMappingId: positiveId,
    riskDimension: { type: 'string' },
    riskBand: { type: 'string' },
    scorePointsSuggested: nullableString,
    reasonCode: { type: 'string' },
    explanation: nullableString,
    modelUsage: nullableString,
    validFrom: dateOnly,
    validUntil: dateOnly,
  },
} satisfies SchemaObject;

const contextItemSchema = {
  type: 'object',
  properties: {
    contextItemId: positiveId,
    itemCode: { type: 'string' },
    itemName: { type: 'string' },
    itemType: { type: 'string' },
    attributes: { type: 'object', additionalProperties: true },
    sourceId: { ...positiveId, nullable: true },
    confidenceScore: nullableString,
    isActive: { type: 'boolean' },
    aliases: { type: 'array', items: aliasSchema },
    riskMappings: { type: 'array', items: riskMappingSchema },
  },
} satisfies SchemaObject;

export const catalogListResponseSchema = {
  type: 'object',
  properties: { items: { type: 'array', items: catalogSchema } },
  required: ['items'],
} satisfies SchemaObject;

export const catalogVersionDetailResponseSchema = {
  type: 'object',
  properties: {
    catalog: catalogSchema,
    version: {
      ...catalogVersionSummarySchema,
      properties: {
        ...catalogVersionSummarySchema.properties,
        approvedAt: { type: 'string', format: 'date-time', nullable: true },
        notes: nullableString,
      },
    },
    items: { type: 'array', items: contextItemSchema },
  },
  required: ['catalog', 'version', 'items'],
} satisfies SchemaObject;

const definitionCommonProperties = {
  dataType: nullableString,
  riskDimension: nullableString,
  isActive: { type: 'boolean' },
  ownerTeam: nullableString,
  domainCode: nullableString,
  reviewStatus: nullableString,
};

function definitionSchema(kind: 'observation' | 'event' | 'attribute' | 'feature'): SchemaObject {
  const names = {
    observation: ['observationDefinitionId', 'observationCode', 'observationName'],
    event: ['eventDefinitionId', 'eventCode', 'eventName'],
    attribute: ['attributeDefinitionId', 'attributeCode', 'attributeName'],
    feature: ['featureDefinitionId', 'featureCode', 'featureName'],
  }[kind];
  const properties: Record<string, SchemaObject> = {
    [names[0]]: positiveId,
    [names[1]]: { type: 'string' },
    [names[2]]: { type: 'string' },
    ...definitionCommonProperties,
  };
  if (kind === 'observation') properties.sourceGroup = nullableString;
  if (kind === 'event') {
    properties.eventFamily = nullableString;
    properties.sourcePackage = nullableString;
    properties.isHighVolume = { type: 'boolean' };
    properties.relatedTables = { type: 'array', items: { type: 'string' } };
  }
  if (kind === 'attribute') {
    properties.entityScope = nullableString;
    properties.isSensitive = { type: 'boolean' };
  }
  if (kind === 'feature') {
    properties.featureFamily = nullableString;
    properties.isModelInput = { type: 'boolean' };
    properties.isPolicyRuleInput = { type: 'boolean' };
  }
  return { type: 'object', properties, required: names };
}

export const definitionsResponseSchema = {
  type: 'object',
  description: 'Definiciones semánticas disponibles para observación, reglas, features y decisiones.',
  properties: {
    observations: { type: 'array', items: definitionSchema('observation') },
    events: { type: 'array', items: definitionSchema('event') },
    attributes: { type: 'array', items: definitionSchema('attribute') },
    features: { type: 'array', items: definitionSchema('feature') },
  },
  required: ['observations', 'events', 'attributes', 'features'],
} satisfies SchemaObject;

export const definitionsPackageResponseSchema = {
  type: 'object',
  properties: {
    domain: { type: 'string' },
    eventsProcessed: { type: 'integer', minimum: 0 },
    observationsProcessed: { type: 'integer', minimum: 0 },
    attributesProcessed: { type: 'integer', minimum: 0 },
    featuresProcessed: { type: 'integer', minimum: 0 },
  },
  required: ['domain', 'eventsProcessed', 'observationsProcessed', 'attributesProcessed', 'featuresProcessed'],
} satisfies SchemaObject;

export const createCatalogVersionResponseSchema = {
  type: 'object',
  properties: {
    catalogCode: { type: 'string' },
    catalogVersionId: positiveId,
    status: { type: 'string', enum: ['draft'] },
    itemsCreated: { type: 'integer', minimum: 0 },
    aliasesCreated: { type: 'integer', minimum: 0 },
    riskMappingsCreated: { type: 'integer', minimum: 0 },
  },
} satisfies SchemaObject;

export const catalogVersionStatusResponseSchema = {
  type: 'object',
  properties: { catalogVersionId: positiveId, status: { type: 'string' } },
  required: ['catalogVersionId', 'status'],
} satisfies SchemaObject;

export const catalogDecisionResponseSchema = {
  type: 'object',
  properties: {
    catalogVersionId: positiveId,
    decision: { type: 'string', enum: ['approve', 'reject', 'publish', 'retire'] },
    status: { type: 'string' },
    publishedAt: { type: 'string', format: 'date-time', nullable: true },
  },
} satisfies SchemaObject;

export const catalogIngestionResponseSchema = {
  type: 'object',
  properties: {
    ingestionJobId: positiveId,
    status: { type: 'string' },
    stagingItemsCreated: { type: 'integer', minimum: 0 },
  },
} satisfies SchemaObject;

export const stagingDecisionResponseSchema = {
  type: 'object',
  properties: {
    processed: { type: 'integer', minimum: 0 },
    approved: { type: 'integer', minimum: 0 },
    rejected: { type: 'integer', minimum: 0 },
    itemsCreated: { type: 'integer', minimum: 0 },
  },
} satisfies SchemaObject;
