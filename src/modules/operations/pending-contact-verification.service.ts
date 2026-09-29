/**
 * @file Servicio de aplicación: la cola de contactos declarados y sin verificar.
 * @business Permite a operaciones ver a quién no le llegó el código de verificación y reenviárselo.
 * @system Cruza `customer_contact_methods.status = 'unverified'` con su cliente, por páginas y con buscador; sin escrituras.
 */
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { buildPaginationMeta, PaginationMeta } from '../../common/utils/pagination/pagination.util.js';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import { PendingContactVerificationItemDto } from './operations.dtos.js';
import { PendingContactsQueryDto } from './operations.schemas.js';

const tabla = (nombre: string): string => `${atlasSchemaFor(nombre)}.${nombre}`;

/**
 * El contacto y su cliente en un solo JOIN. Un contacto cuyo cliente ya no existe (o está borrado)
 * no entra —igual que antes, cuando se descartaba en memoria—, pero ahora tampoco cuenta en el total.
 */
const FROM = `
  FROM ${tabla('customer_contact_methods')} cm
  JOIN ${tabla('customers')} c ON c._id = cm.customer_id AND c._tenant_id = cm._tenant_id AND COALESCE(c._deleted, false) = false
 WHERE cm._tenant_id = $tenantId AND cm.status = 'unverified' AND COALESCE(cm._deleted, false) = false`;

type Fila = {
  customerId: string;
  customerCode: string | null;
  lifecycleStatus: string | null;
  customerCreatedAt: Date | null;
  contactMethodId: string;
  contactType: string | null;
  valueLast4: string | null;
  emailDomain: string | null;
  isPrimary: boolean | null;
  contactCreatedAt: Date | null;
};

export type PendingContactsSummary = { total: number; email: number; phone: number };

@Injectable()
export class PendingContactVerificationService {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  /**
   * Sale de `customer_contact_methods.status = 'unverified'`, no del estado del cliente: una
   * cuenta puede estar `active` y aun así tener el correo sin confirmar, y ése es justo el caso
   * que hay que poder ver para reenviarle el código.
   *
   * `summary` es de TODA la cola del tenant (no de la página ni del filtro): son las cifras que dicen
   * cuánto hay pendiente, y no deben cambiar porque alguien haya buscado un cliente.
   */
  async list(
    tenantId: string,
    query: PendingContactsQueryDto,
  ): Promise<{ items: PendingContactVerificationItemDto[]; meta: PaginationMeta; summary: PendingContactsSummary }> {
    const bind: Record<string, unknown> = { tenantId };
    const filtros: string[] = [];
    if (query.contactType) {
      bind.contactType = query.contactType;
      filtros.push('cm.contact_type = $contactType');
    }
    if (query.q) {
      bind.q = containsLikePattern(query.q.trim());
      filtros.push('(c.customer_code ILIKE $q OR cm.email_domain ILIKE $q OR cm.value_last_4 ILIKE $q)');
    }
    const where = [FROM, ...filtros].join(' AND ');

    const [filas, conteo, resumen] = await Promise.all([
      this.sequelize.query<Fila>(
        `SELECT cm.customer_id::text AS "customerId", c.customer_code AS "customerCode", c.lifecycle_status AS "lifecycleStatus",
                c._created_at AS "customerCreatedAt", cm._id::text AS "contactMethodId", cm.contact_type AS "contactType",
                cm.value_last_4 AS "valueLast4", cm.email_domain AS "emailDomain", cm.is_primary AS "isPrimary",
                cm._created_at AS "contactCreatedAt"
           ${where}
          ORDER BY cm._created_at DESC, cm._id DESC
          LIMIT $limit OFFSET $offset`,
        { type: QueryTypes.SELECT, bind: { ...bind, limit: query.limit, offset: (query.page - 1) * query.limit } },
      ),
      this.sequelize.query<{ total: string }>(`SELECT COUNT(*)::text AS total ${where}`, { type: QueryTypes.SELECT, bind }),
      this.sequelize.query<{ total: string; email: string; phone: string }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE cm.contact_type = 'email')::text AS email,
                COUNT(*) FILTER (WHERE cm.contact_type = 'phone')::text AS phone
           ${FROM}`,
        { type: QueryTypes.SELECT, bind: { tenantId } },
      ),
    ]);

    return {
      items: filas.map((fila) => ({
        ...fila,
        customerCreatedAt: fila.customerCreatedAt ? new Date(fila.customerCreatedAt).toISOString() : null,
        contactCreatedAt: fila.contactCreatedAt ? new Date(fila.contactCreatedAt).toISOString() : null,
      })),
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, Number(conteo[0]?.total ?? 0)),
      summary: {
        total: Number(resumen[0]?.total ?? 0),
        email: Number(resumen[0]?.email ?? 0),
        phone: Number(resumen[0]?.phone ?? 0),
      },
    };
  }
}
