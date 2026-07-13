import type { SchemaObject } from '../../common/openapi/zod-to-schema.util.js';

const stringArray = { type: 'array', items: { type: 'string' } } satisfies SchemaObject;

export const businessTermSchema = {
  type: 'object',
  description: 'Término unificado proveniente de un dominio, tabla o campo del catálogo de datos.',
  properties: {
    termId: { type: 'string', pattern: '^(domain|table|field):.+$', example: 'domain:RIESGO_CREDITO' },
    key: { type: 'string' },
    name: { type: 'string' },
    definition: { type: 'string' },
    domain: { type: 'string' },
    owner: { type: 'string' },
    status: { type: 'string' },
    relatedTables: stringArray,
    relatedColumns: stringArray,
    relatedEndpoints: stringArray,
    relatedReports: stringArray,
    metadata: { type: 'object', additionalProperties: true },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'termId',
    'key',
    'name',
    'definition',
    'domain',
    'owner',
    'status',
    'relatedTables',
    'relatedColumns',
    'relatedReports',
    'metadata',
    'updatedAt',
  ],
} satisfies SchemaObject;

export const businessTermListResponseSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: businessTermSchema },
    meta: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        total: { type: 'integer', minimum: 0 },
        totalPages: { type: 'integer', minimum: 1 },
      },
      required: ['page', 'limit', 'total', 'totalPages'],
    },
  },
  required: ['items', 'meta'],
} satisfies SchemaObject;

export const businessTermDetailResponseSchema = {
  ...businessTermSchema,
  properties: {
    ...businessTermSchema.properties,
    synonyms: stringArray,
    examples: stringArray,
    restrictions: stringArray,
    relations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          relationId: { type: 'string' },
          relationType: { type: 'string' },
          targetType: { type: 'string' },
          targetId: { type: 'string' },
          targetLabel: { type: 'string' },
          sourceTable: { type: 'string' },
          sourceColumn: { type: 'string', nullable: true },
          targetTable: { type: 'string' },
          targetColumn: { type: 'string', nullable: true },
        },
        required: ['relationId', 'relationType', 'targetType', 'targetId', 'targetLabel'],
      },
    },
    audit: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          auditId: { type: 'string' },
          action: { type: 'string' },
          actor: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
        required: ['auditId', 'action', 'actor', 'createdAt'],
      },
    },
  },
  required: [...(businessTermSchema.required ?? []), 'synonyms', 'examples', 'restrictions', 'relations', 'audit'],
} satisfies SchemaObject;
