/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida y compone configuración tipada al arrancar.
 */
import { z } from 'zod';
import { booleanEnvSchema, optionalLongSecretEnvSchema, optionalUrlEnvSchema } from './env.primitives.js';

/**
 * Atlas Assist: el asistente de IA de la app del cliente (AtlasAIService).
 *
 * La app NUNCA habla con el servicio de IA: llama a `/mobile/assist/*` de este backend con su
 * sesión de siempre, y este backend reenvía de servidor a servidor con una clave propia. Así la
 * clave no viaja en ningún bundle (todo `EXPO_PUBLIC_*` es público), no hay CORS nuevo que abrir y
 * el token HS256 del cliente no tiene que convertirse en el RS256 que el servicio de IA verifica.
 *
 * `ASSIST_ENABLED` apagada (el defecto) responde 404 en toda la superficie `/mobile/assist` y la
 * app esconde el botón de ayuda: es el interruptor que permite desplegar backend y app sin acoplar
 * sus tiempos, y el corte inmediato si el asistente hay que apagarlo sin redesplegar la app.
 *
 * Bloque propio y no dentro de `env.schema.ts` por la misma razón que el del motor: la
 * configuración de una integración crece con la integración.
 */
export const assistEnvShape = {
  ASSIST_ENABLED: booleanEnvSchema,
  ATLAS_AI_SERVICE_URL: optionalUrlEnvSchema,
  /** La clave con la que el servicio de IA reconoce a Core (cabecera `x-atlas-service-key`, ≥32). */
  ATLAS_AI_SERVICE_KEY: optionalLongSecretEnvSchema,
  /**
   * Cuánto se espera al servicio de IA. Su peor caso legítimo es clasificación (6 s) + respuesta
   * (20 s); 28 s deja margen y sigue por debajo del tope de 30 s con el que este backend corta cada
   * petición entrante, de modo que el timeout lo declara Core con un error amable y no el
   * interceptor genérico.
   */
  ATLAS_AI_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(28_000),
};
