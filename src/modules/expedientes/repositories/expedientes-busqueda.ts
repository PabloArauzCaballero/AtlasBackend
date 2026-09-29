/**
 * @file Búsqueda del listado de expedientes: por qué columnas casa lo que se escribe.
 * @business Guarda y recupera el expediente de una persona y su árbol de archivos.
 * @system encapsula las consultas de expedientes, nodos y actividad.
 */
import { Op, WhereOptions, literal } from 'sequelize';
import { containsLikePattern } from '../../../common/utils/strings/like-pattern.util.js';
import { atlasSchemaFor } from '../../../database/domain-schemas.js';

const PARTNER_PROFILES = `${atlasSchemaFor('partner_profiles')}.partner_profiles`;

/** Los comercios del tenant cuya razón social, nombre comercial o NIT contienen lo buscado. */
const COMERCIOS_QUE_COINCIDEN = literal(`(
  SELECT p._id FROM ${PARTNER_PROFILES} p
   WHERE p._tenant_id = :tenantBusqueda
     AND (p.legal_name ILIKE :patronBusqueda OR p.trade_name ILIKE :patronBusqueda OR p.tax_id ILIKE :patronBusqueda)
)`);

/**
 * Código de cliente, identificador del sujeto y —para un comercio— su razón social, su nombre
 * comercial y su NIT.
 *
 * La pantalla prometía «nombre del comercio» y sólo se buscaba `customer_code`, que para un comercio
 * es la FOTO de su nombre comercial (o «NIT …») al abrir la carpeta: la razón social no se
 * encontraba nunca y un nombre cambiado después, tampoco. Ahora se pregunta a su ficha viva.
 */
export function busquedaDeExpedientes(tenantId: string, q: string): { condiciones: WhereOptions[]; replacements: Record<string, string> } {
  const patron = containsLikePattern(q);
  return {
    condiciones: [
      { customerCode: { [Op.iLike]: patron } },
      { subjectType: 'partner', subjectId: { [Op.in]: COMERCIOS_QUE_COINCIDEN } },
      ...(/^\d+$/.test(q) ? [{ subjectId: q }] : []),
    ],
    replacements: { tenantBusqueda: tenantId, patronBusqueda: patron },
  };
}
