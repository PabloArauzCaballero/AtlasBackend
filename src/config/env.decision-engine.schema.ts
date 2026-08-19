/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida y compone configuración tipada al arrancar.
 */
import { z } from 'zod';
import { optionalUrlEnvSchema } from './env.primitives.js';

/**
 * ATLAS Decision Engine: el motor de políticas versionadas que decide crédito, riesgo y fraude.
 *
 * Vacío = integración APAGADA, y entonces la decisión de crédito NO se automatiza: cae a revisión
 * manual. Ese es el respaldo correcto. El heurístico `risk_heuristic_v0` sigue sirviendo al
 * onboarding, pero un motor ausente nunca debe traducirse en una aprobación automática de crédito
 * — decidir crédito con constantes escritas en código es justo lo que el propio autor de esas
 * constantes dejó anotado que no se hiciera.
 *
 * Hay DOS credenciales y no una porque el motor separa dos planos: la audiencia `runtime` (rol
 * `DECISION_RUNTIME`) sólo ejecuta decisiones, y el plano de gestión (rol `OPERATIONS`) es el que
 * carga desenlaces. Una sola llave para ambos le daría al componente que decide la capacidad de
 * reescribir la medida de su propio acierto.
 *
 * Bloque propio y no dentro de `env.schema.ts` por el gate de tamaño de archivo: la configuración
 * de una integración crece con la integración, y meterla en el esquema general lo empuja por
 * encima del límite cada vez que se añade una.
 */
export const decisionEngineEnvShape = {
  DECISION_ENGINE_BASE_URL: optionalUrlEnvSchema,
  DECISION_ENGINE_API_KEY: z.string().optional(),
  DECISION_ENGINE_OUTCOME_API_KEY: z.string().optional(),
  DECISION_ENGINE_CREDIT_ARTIFACT: z.string().trim().min(1).max(120).default('credit_underwriting'),
  /**
   * Artefacto que evalúa el riesgo de onboarding, el trabajo que hoy hace `risk_heuristic_v0`.
   *
   * Vacío = el motor no participa en riesgo y manda la política local. Se puede apagar por separado
   * del de crédito porque son dos decisiones distintas con dos artefactos distintos, y una
   * instalación puede querer automatizar una y todavía no la otra.
   */
  DECISION_ENGINE_RISK_ARTIFACT: z.string().trim().max(120).optional(),
  DECISION_ENGINE_ENVIRONMENT_CODE: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_-]{2,40}$/)
    .optional(),
  /**
   * Ruta del healthcheck del motor. Parametrizada por la misma razón que la del ERP: el prefijo de
   * rutas es del otro repo y un cambio suyo no debe leerse aquí como «motor caído».
   */
  /**
   * Dirección del motor SÓLO para reportar su salud en el panel de sistemas.
   *
   * Existe aparte de `DECISION_ENGINE_BASE_URL` porque son dos permisos distintos: integrarse con
   * el motor para decidir crédito exige credenciales reales y sal de sujeto —y el arranque lo
   * verifica—, mientras que preguntarle «¿estás en pie?» no exige nada. Sin esta separación, un
   * despliegue que sólo quiere ver el motor en el panel tendría que encender la automatización del
   * crédito para conseguirlo, que es exactamente al revés de lo prudente. Si `BASE_URL` está
   * configurada manda ella: la integración real sabe mejor dónde vive el motor.
   */
  DECISION_ENGINE_HEALTH_BASE_URL: optionalUrlEnvSchema,
  DECISION_ENGINE_HEALTH_PATH: z.string().trim().min(1).max(200).default('/health'),
  DECISION_ENGINE_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000),
  DECISION_ENGINE_RETRIES: z.coerce.number().int().min(0).max(5).default(1),
  DECISION_ENGINE_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().max(10_000).default(250),
  /**
   * Sal del identificador opaco del sujeto.
   *
   * Cambiarla rompe la unión con las decisiones históricas: el mismo cliente pasaría a verse como
   * uno nuevo y su historia dentro del motor quedaría partida en trozos que ya no se pueden volver
   * a unir. Rotarla es una migración, no un ajuste de configuración.
   */
  DECISION_ENGINE_SUBJECT_SALT: z.string().optional(),
};
