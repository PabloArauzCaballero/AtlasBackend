/**
 * @file Repositorio: la cola de QR de cobro por revisar.
 * @business Deja a quien revisa buscar y filtrar los QR que esperan, por comercio, sucursal o tipo, con sus cifras.
 * @system lee `partner_qr_codes` y resuelve los nombres de `partner_branches`; nunca escribe.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { cast, col, Op, Transaction, where as sqlWhere } from 'sequelize';
import { andAlso } from '../../common/utils/query/text-search.util.js';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';
import { PartnerBranchModel, PartnerQrCodeModel } from '../../database/models/index.js';

type RepositoryOptions = { transaction?: Transaction };

/**
 * Las lecturas de la cola de revisión, aparte de `PartnerCommercialNetworkRepository`: aquél guarda
 * la red comercial del comercio y ésta sólo mira, por páginas, lo que espera a una persona.
 */
@Injectable()
export class PartnerQrReviewRepository {
  constructor(
    @InjectModel(PartnerBranchModel) private readonly branchModel: typeof PartnerBranchModel,
    @InjectModel(PartnerQrCodeModel) private readonly qrModel: typeof PartnerQrCodeModel,
  ) {}

  /**
   * Una página de la cola de QR por revisar, del tenant entero y el más antiguo primero, con el total.
   *
   * `search` trae el texto y los comercios y sucursales que ya casaron con él (los nombres viven en
   * otras tablas): un QR entra si casa por sus propias columnas, por su comercio o por su sucursal.
   */
  listQrCodesPendingReview(
    tenantId: string,
    page: {
      limit: number;
      offset: number;
      qrKind?: string;
      search?: { q: string; partnerIds: readonly string[]; branchIds: readonly string[] };
    },
    options: RepositoryOptions = {},
  ): Promise<{ rows: PartnerQrCodeModel[]; count: number }> {
    const where: Record<string | symbol, unknown> = { tenantId, status: 'pending_review', ...(page.qrKind ? { qrKind: page.qrKind } : {}) };
    if (page.search) {
      const pattern = containsLikePattern(page.search.q);
      andAlso(where, {
        [Op.or]: [
          { bankInstitutionCode: { [Op.iLike]: pattern } },
          { accountNumberMasked: { [Op.iLike]: pattern } },
          { sha256: { [Op.iLike]: pattern } },
          sqlWhere(cast(col('_id'), 'text'), Op.iLike, pattern),
          sqlWhere(cast(col('partner_profile_id'), 'text'), Op.iLike, pattern),
          ...(page.search.partnerIds.length > 0 ? [{ partnerProfileId: { [Op.in]: [...page.search.partnerIds] } }] : []),
          ...(page.search.branchIds.length > 0 ? [{ branchId: { [Op.in]: [...page.search.branchIds] } }] : []),
        ],
      });
    }
    return this.qrModel.findAndCountAll({
      where,
      order: [
        ['_created_at', 'ASC'],
        ['_id', 'ASC'],
      ],
      limit: page.limit,
      offset: page.offset,
      transaction: options.transaction,
    });
  }

  /** Cuántos esperan, de cada tipo, y desde cuándo el más antiguo: de TODA la cola, sin búsqueda ni página. */
  async summarizeQrPendingReview(tenantId: string) {
    const where = { tenantId, status: 'pending_review' };
    const [total, business, bank, oldest] = await Promise.all([
      this.qrModel.count({ where }),
      this.qrModel.count({ where: { ...where, qrKind: 'business' } }),
      this.qrModel.count({ where: { ...where, qrKind: 'bank' } }),
      this.qrModel.min<Date | null, PartnerQrCodeModel>('createdAtValue', { where }),
    ]);
    return { total, business, bank, oldestCreatedAt: oldest ?? null };
  }

  /** Las sucursales del tenant cuyo nombre, código o ciudad contienen el texto (sólo sus ids, para el buscador de QR). */
  async findBranchIdsMatching(tenantId: string, q: string): Promise<string[]> {
    const pattern = containsLikePattern(q);
    const rows = await this.branchModel.findAll({
      attributes: ['id'],
      where: {
        tenantId,
        [Op.or]: [{ name: { [Op.iLike]: pattern } }, { branchCode: { [Op.iLike]: pattern } }, { city: { [Op.iLike]: pattern } }],
      },
    });
    return rows.map((row) => String(row.id));
  }

  /** Varias sucursales en UNA consulta: la cola de QR enseña la de cada uno. */
  findBranchesByIds(tenantId: string, branchIds: readonly string[]): Promise<PartnerBranchModel[]> {
    if (branchIds.length === 0) return Promise.resolve([]);
    return this.branchModel.findAll({ where: { tenantId, id: { [Op.in]: [...new Set(branchIds)] } } });
  }
}
