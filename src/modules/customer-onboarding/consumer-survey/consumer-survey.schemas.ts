/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business La encuesta de hábitos se guarda parcial; la completitud se decide en la elegibilidad.
 * @system valida cada respuesta contra el catálogo `habitos-v1`: opción existente o monto en rango, nunca texto libre.
 */
import { z } from 'zod';
import { CODIGOS_DE_PREGUNTA, PREGUNTAS_DE_HABITOS, VERSION_DE_ENCUESTA } from './consumer-survey.catalog.js';

const preguntaPorCodigo = new Map(PREGUNTAS_DE_HABITOS.map((p) => [p.code, p]));

const respuestaSchema = z
  .object({
    questionCode: z.string().refine((c) => CODIGOS_DE_PREGUNTA.includes(c), 'SURVEY_QUESTION_UNKNOWN'),
    answerCode: z.string().trim().min(1).max(60).optional(),
    answerValue: z.number().finite().optional(),
    /** Cuánto tardó en contestar desde que vio la pregunta. Lo mide la app; se guarda tal cual. */
    answeredInMs: z.number().int().min(0).max(3_600_000),
  })
  .strict()
  .superRefine((r, ctx) => {
    const pregunta = preguntaPorCodigo.get(r.questionCode);
    if (!pregunta) return;
    if (pregunta.type === 'opcion') {
      if (!r.answerCode || !pregunta.options?.some((o) => o.code === r.answerCode)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SURVEY_OPTION_UNKNOWN', path: ['answerCode'] });
      }
    } else if (
      r.answerValue === undefined ||
      r.answerValue < (pregunta.min ?? 0) ||
      r.answerValue > (pregunta.max ?? Number.MAX_SAFE_INTEGER)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SURVEY_AMOUNT_OUT_OF_RANGE', path: ['answerValue'] });
    }
  });

export const consumerSurveySchema = z
  .object({
    surveyVersion: z.literal(VERSION_DE_ENCUESTA),
    answers: z.array(respuestaSchema).min(1).max(CODIGOS_DE_PREGUNTA.length),
  })
  .strict();

export type ConsumerSurveyDto = z.infer<typeof consumerSurveySchema>;
