import { z } from 'zod';

/**
 * Schemas Zod de schema-management.
 *
 * Notas de robustez:
 * - Los query params HTTP llegan como string: se usa z.coerce para limit/offset/booleans.
 * - Los IDs son string (BIGINT de Postgres → string; evita pérdida de precisión).
 * - Nombres SQL validados con regex estricta ANTES de llegar al servicio de validación
 *   (defensa en profundidad: Zod + SchemaManagementValidationService).
 */

const sqlIdentifier = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9_]*$/, 'Must be lowercase snake_case starting with a letter');

const numericIdString = z.string().regex(/^\d+$/, 'Must be a numeric id');

// ============================================================================
// GET /operations/schema/versions
// ============================================================================

export const schemaVersionsListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    includeInactive: z.coerce.boolean().default(false),
  })
  .strict();

export type SchemaVersionsListQuery = z.infer<typeof schemaVersionsListQuerySchema>;

// ============================================================================
// GET /operations/schema/tables
// ============================================================================

export const schemaTablesListQuerySchema = z
  .object({
    versionId: numericIdString,
    tableType: z.enum(['transactional', 'catalog', 'audit', 'operational']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type SchemaTablesListQuery = z.infer<typeof schemaTablesListQuerySchema>;

// ============================================================================
// POST /operations/schema/tables (proponer tabla nueva)
// ============================================================================

export const createSchemaTableRequestSchema = z
  .object({
    tableName: sqlIdentifier.refine((v) => v.length >= 3, 'Table name must be at least 3 chars'),
    tableType: z.enum(['transactional', 'catalog', 'audit', 'operational']),
    isAppendOnly: z.boolean().default(false),
    isTenantScoped: z.boolean().default(true),
    description: z.string().max(500).optional(),
    columns: z
      .array(
        z
          .object({
            columnName: z
              .string()
              .min(1)
              .max(120)
              .regex(/^_?[a-z][a-z0-9_]*$/, 'Must be snake_case (leading underscore allowed)'),
            columnType: z.string().min(1).max(60),
            isNullable: z.boolean().default(false),
            isImmutable: z.boolean().default(false),
            isPii: z.boolean().default(false),
            isIndexed: z.boolean().default(false),
            defaultValue: z.string().max(255).optional(),
            description: z.string().max(255).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    relationships: z
      .array(
        z
          .object({
            sourceColumnName: z
              .string()
              .min(1)
              .max(120)
              .regex(/^_?[a-z][a-z0-9_]*$/),
            targetTableName: sqlIdentifier,
            targetColumnName: z
              .string()
              .min(1)
              .max(120)
              .regex(/^_?[a-z][a-z0-9_]*$/),
            cascadeDelete: z.boolean().default(false),
          })
          .strict(),
      )
      .default([]),
    justification: z.string().min(10, 'Justification must explain why this table is needed (min 10 chars)').max(1000),
  })
  .strict();

export type CreateSchemaTableRequest = z.infer<typeof createSchemaTableRequestSchema>;

// ============================================================================
// GET /operations/schema/change-log
// ============================================================================

export const schemaChangeLogQuerySchema = z
  .object({
    approvalStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
    changeType: z
      .string()
      .max(30)
      .regex(/^[A-Z_]+$/, 'Change type is UPPER_SNAKE_CASE (e.g. CREATE_TABLE)')
      .optional(),
    requesterUserId: numericIdString.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type SchemaChangeLogQuery = z.infer<typeof schemaChangeLogQuerySchema>;

// ============================================================================
// PATCH /operations/schema/change-log/:changeId/approve
// ============================================================================

export const approveSchemaChangeRequestSchema = z
  .object({
    approval: z.enum(['approve', 'reject']),
    approvalNotes: z.string().min(5).max(500).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // Un rechazo sin justificación no es auditable: exigir notas al rechazar.
    if (data.approval === 'reject' && !data.approvalNotes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['approvalNotes'],
        message: 'approvalNotes is required when rejecting a change (audit requirement)',
      });
    }
  });

export type ApproveSchemaChangeRequest = z.infer<typeof approveSchemaChangeRequestSchema>;
