/**
 * @file Repositorio: la red comercial del comercio — representantes, sucursales, QR y cajas.
 * @business Es lo que hace que una venta se pueda atribuir a un local y a una caja concretos.
 * @system persistencia de las cinco entidades que cuelgan del expediente, sin tocar el expediente.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { cast, col, Op, Transaction, where as sqlWhere } from 'sequelize';
import { containsLikePattern } from '../../common/utils/strings/like-pattern.util.js';
import { andAlso } from '../../common/utils/query/text-search.util.js';
import {
  PartnerBranchModel,
  PartnerLegalRepresentativeModel,
  PartnerPosTerminalModel,
  PartnerQrCodeModel,
} from '../../database/models/index.js';

type RepositoryOptions = { transaction?: Transaction };

/**
 * Lo que CUELGA del expediente, separado del expediente.
 *
 * `PartnerOnboardingRepository` guardaba las dos cosas y llegaba a 414 líneas: el perfil del
 * comercio —que se abre una vez, se verifica y se decide— y su red comercial, que cambia mientras
 * el negocio opera. Son ritmos distintos y públicos distintos: quien busca cómo se resuelve un QR
 * no debería tener que recorrer las consultas de la cola de verificación para encontrarlo.
 */
@Injectable()
export class PartnerCommercialNetworkRepository {
  constructor(
    @InjectModel(PartnerLegalRepresentativeModel)
    private readonly representativeModel: typeof PartnerLegalRepresentativeModel,
    @InjectModel(PartnerBranchModel) private readonly branchModel: typeof PartnerBranchModel,
    @InjectModel(PartnerQrCodeModel) private readonly qrModel: typeof PartnerQrCodeModel,
    @InjectModel(PartnerPosTerminalModel) private readonly posModel: typeof PartnerPosTerminalModel,
  ) {}

  listRepresentatives(
    tenantId: string,
    partnerProfileId: string,
    options: RepositoryOptions = {},
  ): Promise<PartnerLegalRepresentativeModel[]> {
    return this.representativeModel.findAll({
      where: { tenantId, partnerProfileId },
      order: [['_id', 'ASC']],
      transaction: options.transaction,
    });
  }

  createRepresentative(
    values: {
      tenantId: string;
      partnerProfileId: string;
      fullName: string;
      documentType: string;
      documentNumber: string;
      powerOfAttorneyKey: string | null;
    },
    options: RepositoryOptions = {},
  ): Promise<PartnerLegalRepresentativeModel> {
    return this.representativeModel.create({ ...values, createdAtValue: new Date() }, { transaction: options.transaction });
  }

  listBranches(tenantId: string, partnerProfileId: string, options: RepositoryOptions = {}): Promise<PartnerBranchModel[]> {
    return this.branchModel.findAll({
      where: { tenantId, partnerProfileId },
      order: [['branch_code', 'ASC']],
      transaction: options.transaction,
    });
  }

  findBranchById(
    tenantId: string,
    partnerProfileId: string,
    branchId: string,
    options: RepositoryOptions = {},
  ): Promise<PartnerBranchModel | null> {
    return this.branchModel.findOne({
      where: { tenantId, partnerProfileId, id: branchId },
      transaction: options.transaction,
    });
  }

  createBranch(
    values: {
      tenantId: string;
      partnerProfileId: string;
      branchCode: string;
      name: string;
      addressLine: string | null;
      city: string | null;
      latitude: number | null;
      longitude: number | null;
      erpBranchId: string | null;
    },
    options: RepositoryOptions = {},
  ): Promise<PartnerBranchModel> {
    return this.branchModel.create({ ...values, status: 'active', createdAtValue: new Date() }, { transaction: options.transaction });
  }

  listQrCodes(tenantId: string, partnerProfileId: string, options: RepositoryOptions = {}): Promise<PartnerQrCodeModel[]> {
    return this.qrModel.findAll({
      where: { tenantId, partnerProfileId },
      order: [['_id', 'DESC']],
      transaction: options.transaction,
    });
  }

  /**
   * El QR vigente de un ámbito, si lo hay. `branchId` nulo es el de la empresa entera, y se
   * compara con `IS NULL` a propósito: en SQL `NULL = NULL` no es cierto nunca, así que buscar el
   * QR de la empresa con una igualdad devolvería siempre vacío y se crearía uno nuevo cada vez.
   */
  findLiveQr(
    tenantId: string,
    partnerProfileId: string,
    qrKind: string,
    branchId: string | null,
    options: RepositoryOptions = {},
  ): Promise<PartnerQrCodeModel | null> {
    return this.qrModel.findOne({
      where: {
        tenantId,
        partnerProfileId,
        qrKind,
        branchId: branchId === null ? { [Op.is]: null } : branchId,
        status: { [Op.in]: ['pending_review', 'active'] },
      },
      transaction: options.transaction,
    });
  }

  createQrCode(
    values: {
      tenantId: string;
      partnerProfileId: string;
      branchId: string | null;
      qrKind: string;
      storageKey: string;
      contentType: string;
      sizeBytes: number;
      sha256: string;
      bankInstitutionCode: string | null;
      accountNumberMasked: string | null;
    },
    options: RepositoryOptions = {},
  ): Promise<PartnerQrCodeModel> {
    return this.qrModel.create({ ...values, status: 'pending_review', createdAtValue: new Date() }, { transaction: options.transaction });
  }

  markQrReplaced(qr: PartnerQrCodeModel, replacedById: string, options: RepositoryOptions = {}): Promise<PartnerQrCodeModel> {
    return qr.update({ status: 'replaced', replacedById, updatedAtValue: new Date() }, { transaction: options.transaction });
  }

  /**
   * El QR ACTIVO de un ámbito: el único que se le enseña a un cliente.
   *
   * Es distinto de `findLiveQr` a propósito. Aquél incluye `pending_review` porque el comercio y el
   * registro necesitan ver «lo que hay», revisado o no; éste sólo devuelve lo que una persona ya
   * aprobó, porque es lo que decide a qué cuenta transfiere un cliente.
   */
  findActiveQr(
    tenantId: string,
    partnerProfileId: string,
    qrKind: string,
    branchId: string | null,
    options: RepositoryOptions = {},
  ): Promise<PartnerQrCodeModel | null> {
    return this.qrModel.findOne({
      where: {
        tenantId,
        partnerProfileId,
        qrKind,
        branchId: branchId === null ? { [Op.is]: null } : branchId,
        status: 'active',
      },
      transaction: options.transaction,
    });
  }

  findQrById(
    tenantId: string,
    partnerProfileId: string,
    qrId: string,
    options: RepositoryOptions = {},
  ): Promise<PartnerQrCodeModel | null> {
    return this.qrModel.findOne({ where: { tenantId, partnerProfileId, id: qrId }, transaction: options.transaction });
  }

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

  markQrReviewed(
    qr: PartnerQrCodeModel,
    review: { status: 'active' | 'rejected'; reviewedByInternalUserId: string | null; reviewNote: string | null },
    options: RepositoryOptions = {},
  ): Promise<PartnerQrCodeModel> {
    const now = new Date();
    return qr.update(
      {
        status: review.status,
        verifiedAt: now,
        reviewedByInternalUserId: review.reviewedByInternalUserId,
        reviewNote: review.reviewNote,
        updatedAtValue: now,
      },
      { transaction: options.transaction },
    );
  }

  listPosTerminals(tenantId: string, partnerProfileId: string, options: RepositoryOptions = {}): Promise<PartnerPosTerminalModel[]> {
    return this.posModel.findAll({
      where: { tenantId, partnerProfileId },
      order: [['_id', 'ASC']],
      transaction: options.transaction,
    });
  }

  findPosBySerial(tenantId: string, terminalSerial: string, options: RepositoryOptions = {}): Promise<PartnerPosTerminalModel | null> {
    return this.posModel.findOne({
      where: { tenantId, terminalSerial, status: { [Op.ne]: 'retired' } },
      transaction: options.transaction,
    });
  }

  findPosById(
    tenantId: string,
    partnerProfileId: string,
    terminalId: string,
    options: RepositoryOptions = {},
  ): Promise<PartnerPosTerminalModel | null> {
    return this.posModel.findOne({
      where: { tenantId, partnerProfileId, id: terminalId },
      transaction: options.transaction,
    });
  }

  createPosTerminal(
    values: {
      tenantId: string;
      partnerProfileId: string;
      branchId: string;
      terminalSerial: string;
      terminalAlias: string | null;
      provider: string | null;
      model: string | null;
    },
    options: RepositoryOptions = {},
  ): Promise<PartnerPosTerminalModel> {
    return this.posModel.create({ ...values, status: 'registered', createdAtValue: new Date() }, { transaction: options.transaction });
  }

  updatePosStatus(terminal: PartnerPosTerminalModel, status: string, options: RepositoryOptions = {}): Promise<PartnerPosTerminalModel> {
    return terminal.update(
      {
        status,
        // Se sella cuándo entró en servicio la primera vez y no se vuelve a tocar: es la fecha
        // desde la que ese terminal pudo cobrar, y reescribirla al reactivarlo borraría el tramo
        // que una investigación necesita mirar.
        activatedAt: status === 'active' && terminal.activatedAt === null ? new Date() : terminal.activatedAt,
        updatedAtValue: new Date(),
      },
      { transaction: options.transaction },
    );
  }
}
