/**
 * @file Esquemas Zod: suites y pasos de prueba controlada del catálogo de sistemas.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { z } from 'zod';

const positiveId = z.string().regex(/^[1-9][0-9]*$/);

const httpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const suiteTypeSchema = z.enum(['INTEGRATION', 'SMOKE', 'REGRESSION', 'E2E_API', 'LOAD']);
export const environmentSchema = z.enum(['LOCAL', 'STAGING', 'PRODUCTION_READONLY']);
export const jsonObjectSchema = z.record(z.string(), z.unknown());
const pathTemplateSchema = z
  .string()
  .trim()
  .min(1)
  .max(1200)
  .refine((value) => value.startsWith('/') && !value.startsWith('//'), {
    message: 'pathTemplate debe ser una ruta relativa al host permitido e iniciar con un solo /.',
  });

export const createTestSuiteSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(180)
    .regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(3).max(220),
  description: z.string().trim().max(4000).optional(),
  module: z.string().trim().min(2).max(120),
  suiteType: suiteTypeSchema.default('INTEGRATION'),
  environmentScope: z.array(environmentSchema).min(1).max(3).default(['LOCAL', 'STAGING']),
  isEnabled: z.boolean().default(true),
  requiresSeedData: z.boolean().default(true),
  isSafeForProduction: z.boolean().default(false),
  requiresDestructivePermission: z.boolean().optional(),
});

// No se construye como `createTestSuiteSchema.partial()`: Zod re-aplica `.default()` de cada
// campo incluso después de `.partial()`, así que un PATCH parcial (o vacío) llegaría con
// suiteType/environmentScope/isEnabled/requiresSeedData/isSafeForProduction ya rellenados a sus
// valores de creación — el refine de "al menos un campo" nunca se dispara, y
// SystemsTestSuiteAdminRepository.updateSuite (que escribe todo campo !== undefined) los
// sobrescribiría en silencio en cualquier suite existente. Se declaran los campos opcionales
// explícitamente, sin `.default()`, para que un campo ausente siga siendo `undefined`.
export const updateTestSuiteSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(180)
      .regex(/^[A-Z0-9_]+$/)
      .optional(),
    name: z.string().trim().min(3).max(220).optional(),
    description: z.string().trim().max(4000).optional(),
    module: z.string().trim().min(2).max(120).optional(),
    suiteType: suiteTypeSchema.optional(),
    environmentScope: z.array(environmentSchema).min(1).max(3).optional(),
    isEnabled: z.boolean().optional(),
    requiresSeedData: z.boolean().optional(),
    isSafeForProduction: z.boolean().optional(),
    requiresDestructivePermission: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Debe enviar al menos un campo para actualizar.',
  });

export const createTestStepSchema = z.object({
  endpointId: positiveId.optional().nullable(),
  stepOrder: z.coerce.number().int().positive().max(500),
  name: z.string().trim().min(3).max(220),
  inputMode: z.enum(['DEFAULT', 'CONFIGURABLE', 'GENERATED', 'FROM_PREVIOUS_STEP']).default('DEFAULT'),
  method: httpMethodSchema,
  pathTemplate: pathTemplateSchema,
  defaultHeaders: jsonObjectSchema.default({}),
  defaultPayload: jsonObjectSchema.default({}),
  configSchema: jsonObjectSchema.default({}),
  extractors: jsonObjectSchema.default({}),
  assertions: jsonObjectSchema.default({ expectedStatusCodes: [200, 201] }),
  continueOnFailure: z.boolean().default(false),
  cleanupRequired: z.boolean().default(false),
});

// Mismo problema y mismo fix que `updateTestSuiteSchema` (ver comentario arriba): campos
// opcionales explícitos, sin `.default()`, para que `SystemsTestSuiteAdminRepository.updateStep`
// no reciba de vuelta assertions/extractors/headers/payload reseteados a su default de creación
// en cada PATCH parcial.
export const updateTestStepSchema = z
  .object({
    endpointId: positiveId.optional().nullable(),
    stepOrder: z.coerce.number().int().positive().max(500).optional(),
    name: z.string().trim().min(3).max(220).optional(),
    inputMode: z.enum(['DEFAULT', 'CONFIGURABLE', 'GENERATED', 'FROM_PREVIOUS_STEP']).optional(),
    method: httpMethodSchema.optional(),
    pathTemplate: pathTemplateSchema.optional(),
    defaultHeaders: jsonObjectSchema.optional(),
    defaultPayload: jsonObjectSchema.optional(),
    configSchema: jsonObjectSchema.optional(),
    extractors: jsonObjectSchema.optional(),
    assertions: jsonObjectSchema.optional(),
    continueOnFailure: z.boolean().optional(),
    cleanupRequired: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Debe enviar al menos un campo para actualizar.',
  });

export const reorderTestStepsSchema = z.object({
  steps: z
    .array(
      z.object({
        stepId: positiveId,
        stepOrder: z.coerce.number().int().positive().max(500),
      }),
    )
    .min(1)
    .max(500),
});

export type CreateTestSuiteDto = z.infer<typeof createTestSuiteSchema>;
export type UpdateTestSuiteDto = z.infer<typeof updateTestSuiteSchema>;
export type CreateTestStepDto = z.infer<typeof createTestStepSchema>;
export type UpdateTestStepDto = z.infer<typeof updateTestStepSchema>;
export type ReorderTestStepsDto = z.infer<typeof reorderTestStepsSchema>;
