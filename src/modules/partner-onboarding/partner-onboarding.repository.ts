/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza convierte un comercio declarado en un partner verificable, con locales, cobro y terminales trazables.
 * @system persiste el expediente del partner, sus QR de cobro y sus terminales de punto de venta.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import {
  PartnerBranchModel,
  PartnerLegalRepresentativeModel,
  PartnerPosTerminalModel,
  PartnerProfileModel,
  PartnerQrCodeModel,
} from '../../database/models/index.js';

type RepositoryOptions = { transaction?: Transaction };

/** Estados en los que el expediente todavía admite cambios del comercio. */
export const EDITABLE_PARTNER_STATUSES = ['draft', 'contact_verified', 'documents_submitted'] as const;

/**
 * Estados en los que el comercio puede cambiar su RED COMERCIAL (sucursales y terminales).
 *
 * Es una lista distinta de `EDITABLE_PARTNER_STATUSES` a propósito. Lo que la aprobación congela es
 * la identidad del expediente —matrícula, representante legal, cuenta bancaria—, porque el analista
 * firmó sobre esos datos. Abrir una sucursal o dar de alta un POS es operación del día a día y le
 * ocurre a todo comercio vivo: si lo cerráramos con la aprobación, un comercio aprobado se quedaría
 * para siempre sin poder abrir un local nuevo, que es justo lo contrario de lo que la aprobación
 * significa.
 *
 * `under_review` sigue fuera: mientras un analista mira el expediente, la foto no se mueve.
 */
export const COMMERCIAL_NETWORK_EDITABLE_STATUSES = [...EDITABLE_PARTNER_STATUSES, 'approved'] as const;

@Injectable()
export class PartnerOnboardingRepository {
  constructor(
    @InjectModel(PartnerProfileModel) private readonly profileModel: typeof PartnerProfileModel,
    @InjectModel(PartnerLegalRepresentativeModel)
    private readonly representativeModel: typeof PartnerLegalRepresentativeModel,
    @InjectModel(PartnerBranchModel) private readonly branchModel: typeof PartnerBranchModel,
    @InjectModel(PartnerQrCodeModel) private readonly qrModel: typeof PartnerQrCodeModel,
    @InjectModel(PartnerPosTerminalModel) private readonly posModel: typeof PartnerPosTerminalModel,
  ) {}

  findProfileById(tenantId: string, partnerId: string, options: RepositoryOptions = {}): Promise<PartnerProfileModel | null> {
    return this.profileModel.findOne({
      where: { tenantId, id: partnerId, deleted: false },
      transaction: options.transaction,
    });
  }

  /**
   * Varios expedientes de una vez.
   *
   * Existe para no preguntar uno por uno: la pantalla de pagos agrupa los créditos por comercio y
   * el tablero los reparte por rubro, así que en ambos casos hacen falta TODOS los comercios de la
   * lista a la vez. Resolverlos en bucle convertiría una pantalla en tantas consultas como compras
   * tenga el cliente, y esa cuenta crece justo con los clientes que más usan el producto.
   */
  findProfilesByIds(tenantId: string, partnerIds: readonly string[], options: RepositoryOptions = {}): Promise<PartnerProfileModel[]> {
    if (partnerIds.length === 0) return Promise.resolve([]);
    return this.profileModel.findAll({
      where: { tenantId, id: { [Op.in]: [...new Set(partnerIds)] }, deleted: false },
      transaction: options.transaction,
    });
  }

  /**
   * El expediente con la fila BLOQUEADA hasta el fin de la transacción (`SELECT … FOR UPDATE`).
   *
   * Existe para los flujos que leen un contador, deciden con él y lo escriben. Sin el bloqueo esas
   * tres operaciones no son una: dos peticiones simultáneas leen el mismo valor, las dos pasan el
   * control y las dos escriben el mismo resultado, así que el contador queda como si sólo hubiera
   * habido un intento. Es la verificación de contacto, y con ella el límite de intentos se
   * esquivaba probando en paralelo.
   */
  lockProfileById(tenantId: string, partnerId: string, transaction: Transaction): Promise<PartnerProfileModel | null> {
    return this.profileModel.findOne({
      where: { tenantId, id: partnerId, deleted: false },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
  }

  findProfileByTaxId(tenantId: string, taxId: string, options: RepositoryOptions = {}): Promise<PartnerProfileModel | null> {
    return this.profileModel.findOne({
      where: { tenantId, taxId, deleted: false },
      transaction: options.transaction,
    });
  }

  /**
   * Los expedientes de los que este usuario de comercio es dueño.
   *
   * Hacía falta porque el portal no tenía forma de saber CUÁL es su expediente: sólo conocía el
   * identificador justo después de crearlo, y al recargar la pantalla lo perdía. Sin esto, un
   * comercio no puede volver a entrar a lo suyo salvo que alguien le pase el número a mano.
   */
  findProfilesByOwner(
    tenantId: string,
    ownerMerchantUserId: string,
    options: RepositoryOptions = {},
  ): Promise<PartnerProfileModel[]> {
    return this.profileModel.findAll({
      where: { tenantId, ownerMerchantUserId, deleted: false },
      order: [['id', 'DESC']],
      transaction: options.transaction,
    });
  }

  createProfile(
    values: {
      tenantId: string;
      legalName: string;
      tradeName: string | null;
      taxId: string;
      commercialRegistry: string | null;
      businessCategory: string | null;
      contactEmail: string;
      contactPhone: string | null;
      ownerMerchantUserId?: string | null;
    },
    options: RepositoryOptions = {},
  ): Promise<PartnerProfileModel> {
    return this.profileModel.create(
      {
        ...values,
        onboardingStatus: 'draft',
        createdAtValue: new Date(),
        deleted: false,
        // Explícito y no delegado al DEFAULT de la tabla: el modelo declara la columna NOT NULL,
        // así que Sequelize la incluye en el INSERT con `null` si nadie la fija — y el valor por
        // defecto de PostgreSQL sólo actúa cuando la columna se OMITE, no cuando llega nula.
        contactCodeAttempts: 0,
      },
      { transaction: options.transaction },
    );
  }

  updateProfile(
    profile: PartnerProfileModel,
    values: Partial<{
      onboardingStatus: string;
      submittedAt: Date | null;
      decidedAt: Date | null;
      decidedByInternalUserId: string | null;
      rejectionReason: string | null;
      erpAccountId: string | null;
      emailVerifiedAt: Date | null;
      phoneVerifiedAt: Date | null;
      commercialRegistry: string | null;
      contactCodeHash: string | null;
      contactCodeExpiresAt: Date | null;
      contactCodeAttempts: number;
      contactCodeSentAt: Date | null;
    }>,
    options: RepositoryOptions = {},
  ): Promise<PartnerProfileModel> {
    return profile.update({ ...values, updatedAtValue: new Date() }, { transaction: options.transaction });
  }

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
