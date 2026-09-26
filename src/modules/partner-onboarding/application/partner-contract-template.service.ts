/**
 * @file Servicio de aplicación: el contrato legal por defecto de un inquilino.
 * @business Responde «¿bajo qué texto opera un comercio al que nadie le negoció uno propio?».
 * @system publica versiones nuevas y archiva la anterior; nunca reescribe el cuerpo de una vigente.
 */
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { InjectConnection } from '@nestjs/sequelize';
import { PartnerContractTemplateModel } from '../../../database/models/index.js';

export type ContractTemplateInput = {
  templateCode: string;
  name: string;
  body: string;
  makeDefault: boolean;
  internalUserId: string | null;
};

/**
 * El contrato bajo el que se afilia un comercio, cuando nadie le negoció uno.
 *
 * ## Qué es y qué NO es
 *
 * Es el texto POR DEFECTO del inquilino. Un contrato particular —el que se negocia con un comercio
 * grande, con su comisión y sus plazos— es un término comercial y su sitio es el ERP, igual que el
 * MDR. Meterlo aquí daría dos respuestas a «¿qué firmó este comercio?» y ganaría la de quien
 * consultara primero, que es exactamente el patrón que este trabajo lleva días desmontando.
 *
 * ## El cuerpo no se edita
 *
 * `publish` da de alta una versión NUEVA y archiva la anterior; no hay ningún camino que reescriba
 * el texto de una plantilla vigente. Un contrato es la evidencia de a qué se comprometió alguien un
 * día concreto: editarlo en sitio borraría el texto que un comercio aceptó de verdad y dejaría su
 * expediente afirmando algo que ya no se puede comprobar.
 *
 * ## Por qué en una transacción con bloqueo
 *
 * Marcar el predeterminado son dos escrituras —quitar el anterior, poner el nuevo— y hay un índice
 * único parcial que sólo admite uno vigente. Dos operadores publicando a la vez producirían un 500
 * por violación de índice en el que perdiera; con la transacción, uno espera y el resultado es el
 * que se ve en pantalla.
 */
@Injectable()
export class PartnerContractTemplateService {
  private readonly logger = new Logger(PartnerContractTemplateService.name);

  constructor(
    @InjectModel(PartnerContractTemplateModel)
    private readonly templateModel: typeof PartnerContractTemplateModel,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * La plantilla vigente por defecto, o `null` si el inquilino no ha publicado ninguna.
   *
   * `null` NO es un error: un inquilino recién abierto todavía no tiene contrato, y decirlo es más
   * útil que un 404 que quien llama tendría que traducir. Lo consume el ERP para saber qué texto
   * enseñar, y la verificación del expediente para decirle al Motor si hay contrato.
   */
  async findDefault(tenantId: string): Promise<PartnerContractTemplateModel | null> {
    return this.templateModel.findOne({
      where: { tenantId, isDefault: true, status: 'active', deleted: false },
    });
  }

  /** Si hay contrato vigente. Es lo que viaja al Motor como `kyb_contrato_legal_vigente`. */
  async hasActiveDefault(tenantId: string): Promise<boolean> {
    return (await this.findDefault(tenantId)) !== null;
  }

  async list(tenantId: string): Promise<PartnerContractTemplateModel[]> {
    return this.templateModel.findAll({
      where: { tenantId, deleted: false },
      order: [
        ['template_code', 'ASC'],
        ['version', 'DESC'],
      ],
    });
  }

  /**
   * Publica una versión nueva del contrato.
   *
   * La versión se calcula aquí y no la manda quien llama: pedirla desde fuera invita a repetirla o
   * a saltársela, y el número de versión de un contrato es justo lo que después se cita.
   */
  async publish(tenantId: string, input: ContractTemplateInput): Promise<PartnerContractTemplateModel> {
    return this.sequelize.transaction(async (transaction) => {
      const ultima = await this.templateModel.findOne({
        where: { tenantId, templateCode: input.templateCode, deleted: false },
        order: [['version', 'DESC']],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (input.makeDefault) await this.clearDefault(tenantId, transaction);
      if (ultima && ultima.status === 'active') {
        await ultima.update({ status: 'archived', isDefault: false, updatedAtValue: new Date() }, { transaction });
      }

      const creada = await this.templateModel.create(
        {
          tenantId,
          templateCode: input.templateCode,
          name: input.name,
          version: (ultima?.version ?? 0) + 1,
          body: input.body,
          status: 'active',
          isDefault: input.makeDefault,
          effectiveFrom: new Date(),
          createdByInternalUserId: input.internalUserId,
          createdAtValue: new Date(),
          deleted: false,
        },
        { transaction },
      );
      this.logger.log(`Contrato ${input.templateCode} v${creada.version} publicado (tenant ${tenantId}).`);
      return creada;
    });
  }

  /**
   * Marca como predeterminada una plantilla ya publicada.
   *
   * Sólo una `active`: convertir en predeterminado un texto archivado devolvería a la vida un
   * contrato que alguien retiró, y quien lo retiró tenía un motivo que esta ruta no conoce.
   */
  async setDefault(tenantId: string, templateId: string): Promise<PartnerContractTemplateModel> {
    return this.sequelize.transaction(async (transaction) => {
      const plantilla = await this.templateModel.findOne({
        where: { tenantId, id: templateId, deleted: false },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!plantilla) throw new NotFoundException('PARTNER_CONTRACT_TEMPLATE_NOT_FOUND');
      if (plantilla.status !== 'active') {
        throw new ConflictException(
          `PARTNER_CONTRACT_TEMPLATE_ARCHIVED: la versión ${plantilla.version} de ${plantilla.templateCode} ya fue retirada.`,
        );
      }
      if (plantilla.isDefault) return plantilla;

      await this.clearDefault(tenantId, transaction);
      return plantilla.update({ isDefault: true, updatedAtValue: new Date() }, { transaction });
    });
  }

  private async clearDefault(tenantId: string, transaction: Parameters<typeof this.templateModel.update>[1]['transaction']) {
    await this.templateModel.update(
      { isDefault: false, updatedAtValue: new Date() },
      { where: { tenantId, isDefault: true, deleted: false }, transaction },
    );
  }
}
