/**
 * @file El WHERE de la bandeja de soporte: filtros, búsqueda y visibilidad, compartidos por la página y su resumen.
 * @business Esta pieza sostiene la atención a clientes y comercios con expedientes auditables y SLA medibles.
 * @system arma las condiciones de `support_cases` para el listado y los contadores de la bandeja.
 */
import { Op, WhereOptions, literal } from 'sequelize';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';
import { atlasSchemaFor } from '../../database/domain-schemas.js';

const CUSTOMERS = `${atlasSchemaFor('customers')}.customers`;

/**
 * Casos cuyo cliente tiene un código que contiene lo buscado. El código de cliente es lo que llega
 * en un ticket o en una llamada; el caso guarda sólo el id interno del sujeto.
 */
const casosDeClientesQueCoinciden = (tenantId: string, pattern: string) =>
  literal(`(SELECT c._id FROM ${CUSTOMERS} c WHERE c._tenant_id = ${tenantId} AND c.customer_code ILIKE ${pattern})`);

export type SupportCaseSearch = {
  /** Número de caso, asunto o código de cliente, por partes y sin distinguir mayúsculas. */
  q?: string | null;
  /**
   * Visibilidad de los casos RESTRINGIDOS aplicada en la consulta: sólo un supervisor o el agente
   * asignado los ve. Antes se aplicaba después de traer la página, así que una página podía llegar
   * con menos filas de las pedidas y ningún contador podía contar lo que de verdad se ve.
   */
  restrictedVisibleTo?: { agentProfileId: string | null; isSupervisor: boolean } | null;
};

/**
 * Condiciones extra que añaden la búsqueda y la visibilidad. `escape` es el de la conexión: la
 * subconsulta va como literal (los `count` de Sequelize no aceptan `replacements`) y nada de lo que
 * escribe el usuario entra en ella sin escapar.
 */
export function supportCaseSearchConditions(
  tenantId: string,
  search: SupportCaseSearch,
  escape: (value: string) => string,
): WhereOptions[] {
  const conditions: WhereOptions[] = [];
  const q = search.q?.trim();
  if (q) {
    const pattern = containsLikePattern(q);
    conditions.push({
      [Op.or]: [
        { caseNumber: { [Op.iLike]: pattern } },
        { title: { [Op.iLike]: pattern } },
        { subjectCustomerId: { [Op.in]: casosDeClientesQueCoinciden(escape(tenantId), escape(pattern)) } },
      ],
    });
  }
  const visibility = search.restrictedVisibleTo;
  if (visibility && !visibility.isSupervisor) {
    // Sin perfil de agente no hay «asignado a mí»: comparar con null traería los restringidos SIN responsable.
    const own = visibility.agentProfileId ? [{ currentAssigneeAgentId: visibility.agentProfileId }] : [];
    conditions.push({ [Op.or]: [{ sensitivity: { [Op.ne]: 'RESTRICTED' } }, ...own] });
  }
  return conditions;
}
