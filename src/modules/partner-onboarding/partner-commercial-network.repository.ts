/**
 * @file Repositorio: la red comercial del comercio — representantes, sucursales, QR y cajas.
 * @business Es lo que hace que una venta se pueda atribuir a un local y a una caja concretos.
 * @system persistencia de las cinco entidades que cuelgan del expediente, sin tocar el expediente.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
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
