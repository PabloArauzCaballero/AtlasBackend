/**
 * @file Esquema del listado interno de casos: el de siempre más la búsqueda de la bandeja.
 * @business Esta pieza sostiene la atención a clientes y comercios con expedientes auditables y SLA medibles.
 * @system valida la consulta de la bandeja del equipo sin ampliar la de los propios casos del cliente.
 */
import { z } from 'zod';
import { listCasesQuerySchema } from './support-case.schemas.js';

/**
 * `q` sólo existe para el equipo. La bandeja no tenía buscador: encontrar el caso de un ticket
 * obligaba a pasar páginas de 20 en 20. El cliente y el comercio siguen con su esquema, que no lo
 * necesita (ven sólo sus propios casos).
 */
export const listInternalCasesQuerySchema = listCasesQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
});
export type ListInternalCasesQueryDto = z.infer<typeof listInternalCasesQuerySchema>;
