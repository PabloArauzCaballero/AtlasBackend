/**
 * @file Esquemas Zod: validan entradas y parámetros en el borde del sistema.
 * @business Esta pieza califica la deuda y al cliente para medir pérdida esperada y exposición.
 * @system valida identificadores y límites antes de que el motor recorra la cartera.
 */
import { z } from 'zod';

const databaseId = z.string().regex(/^[1-9][0-9]*$/);

export const ratingLoanParamsSchema = z.object({ loanId: databaseId });
export type RatingLoanParamsDto = z.infer<typeof ratingLoanParamsSchema>;

export const ratingCustomerParamsSchema = z.object({ customerId: databaseId });
export type RatingCustomerParamsDto = z.infer<typeof ratingCustomerParamsSchema>;

/**
 * Cuántas filas de historial devolver.
 *
 * Tiene tope porque el historial de un crédito muy recalificado crece sin límite y una consulta sin
 * cota lo arrastra entero a memoria — el mismo endpoint que hoy responde en milisegundos se
 * convierte, dos años de barridos después, en el que tumba la instancia.
 */
export const ratingHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type RatingHistoryQueryDto = z.infer<typeof ratingHistoryQuerySchema>;

export const ratingSweepSchema = z.object({
  limit: z.number().int().min(1).max(5000).default(500),
});
export type RatingSweepDto = z.infer<typeof ratingSweepSchema>;
