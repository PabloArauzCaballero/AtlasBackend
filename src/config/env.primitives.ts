/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system define los tipos base con los que se declara cada variable de entorno.
 */
import { z } from 'zod';

/**
 * Tipos primitivos con los que se declaran las variables de entorno.
 *
 * Viven fuera de `env.schema.ts` porque los comparten más de un bloque de esquema (el base y el de
 * trabajos de fondo) y porque, mezclados con las ~180 declaraciones de variables, obligaban a leer
 * 50 líneas de mecánica de coerción antes de llegar a la primera variable real.
 *
 * Todo lo que llega del entorno es `string`: de ahí que cada tipo empiece por un `preprocess`.
 */

/** URL opcional. Una cadena vacía se trata como "no configurado", no como URL inválida. */
export const optionalUrlEnvSchema = z.preprocess((value) => {
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}, z.string().url().optional());

/** Cadena de conexión de MongoDB opcional, con el esquema exigido explícitamente. */
export const optionalMongoUrlEnvSchema = z.preprocess(
  (value) => {
    if (typeof value === 'string' && value.trim() === '') return undefined;
    return value;
  },
  z
    .string()
    .regex(/^mongodb(\+srv)?:\/\//, 'Debe iniciar con mongodb:// o mongodb+srv://')
    .optional(),
);

function coerceBoolean(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
  // Se devuelve el valor crudo para que Zod falle con el mensaje de tipo: un `FALSO` mal escrito
  // debe romper el arranque, no interpretarse como `false`.
  return value;
}

/** Booleano con default `false`: la ausencia de la variable apaga la funcionalidad. */
export const booleanEnvSchema = z.preprocess(coerceBoolean, z.boolean()).default(false);

/** Booleano sin default: distingue "no configurado" de "configurado en false". */
export const optionalBooleanEnvSchema = z.preprocess(coerceBoolean, z.boolean()).optional();

/**
 * Cadena opcional que trata `""` como "no configurado".
 *
 * Existe por un caso muy concreto y muy fácil de repetir: un `ARG` de Docker que no se pasa con
 * `--build-arg` produce `ENV VAR=""`, no una variable ausente. Con `z.string().min(1).optional()`
 * eso es un error de validación y el contenedor no arranca — un build local sin argumentos de
 * pipeline quedaba inservible.
 */
export const optionalNonEmptyStringEnvSchema = z.preprocess((value) => {
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}, z.string().min(1).optional());
