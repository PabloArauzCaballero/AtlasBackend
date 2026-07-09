import { z } from 'zod';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface.js';

/**
 * Puente Zod -> OpenAPI para TODO el proyecto. Los ~23 módulos de este backend validan su
 * entrada con Zod (`ZodValidationPipe`), no con clases decoradas con `@ApiProperty` — sin este
 * puente, documentar cada endpoint "a mano" (escribir de nuevo cada `min`/`max`/`enum`/`regex`
 * como un objeto `{ type: 'object', properties: {...} }` separado) garantizaría que la
 * documentación se desincronice del schema real la primera vez que alguien cambie una regla de
 * validación y se olvide de actualizar el decorador Swagger en paralelo.
 *
 * Zod 4 expone `z.toJSONSchema(schema)` nativo (sin dependencias nuevas) — esta función solo
 * adapta esa salida a lo que `@nestjs/swagger` espera en `@ApiBody({ schema })` /
 * `@ApiParam({ schema })` / `@ApiQuery({ schema })`: quita `$schema` (JSON Schema puro, inválido
 * en un `SchemaObject` de OpenAPI 3) y evita que loops de referencia colapsen `SwaggerModule`.
 */
export function zodToApiSchema(schema: z.ZodTypeAny): SchemaObject {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' }) as Record<string, unknown>;
  const { $schema: _drop, ...rest } = jsonSchema;
  return rest as SchemaObject;
}

/**
 * Para un schema `z.object({...})` cuyos campos individuales se documentan como `@ApiProperty`
 * de un DTO de respuesta, o para exponer cada propiedad como `@ApiQuery` separado (los query
 * params de Nest/Swagger no aceptan un solo `schema` de tipo object para todo el query string).
 */
export function zodObjectPropertySchemas(schema: z.ZodObject<z.ZodRawShape>): Record<string, SchemaObject> {
  const full = zodToApiSchema(schema);
  const properties = (full.properties ?? {}) as Record<string, SchemaObject>;
  return properties;
}

export function zodRequiredFields(schema: z.ZodObject<z.ZodRawShape>): string[] {
  const full = zodToApiSchema(schema);
  return Array.isArray(full.required) ? (full.required as string[]) : [];
}
