/**
 * @file Repositorio: aísla el acceso a datos del resto de la aplicación.
 * @business Quién puede ver la carpeta de una persona, y qué subidas están autorizadas ahora.
 * @system encapsula las consultas de concesiones y de tickets de subida firmados.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import { ExpedienteConcesionModel, ExpedienteTicketSubidaModel } from '../../../database/models/index.js';

/**
 * Las dos tablas que autorizan, no las que guardan.
 *
 * Una concesión dice quién puede ver una carpeta; un ticket dice que una subida concreta está
 * permitida durante unos minutos. Ninguna de las dos describe el contenido del expediente, y por
 * eso viven fuera de `ExpedientesRepository`: quien lee el árbol no necesita saber de ellas, y
 * quien las consulta no está leyendo el árbol.
 */
@Injectable()
export class ExpedienteAccesosRepository {
  constructor(
    @InjectModel(ExpedienteConcesionModel) private readonly concesiones: typeof ExpedienteConcesionModel,
    @InjectModel(ExpedienteTicketSubidaModel) private readonly tickets: typeof ExpedienteTicketSubidaModel,
  ) {}

  // ---------------------------------------------------------------- concesiones

  crearConcesion(
    values: {
      tenantId: string;
      nodoId: string;
      principalTipo: string;
      principalId: string;
      nivel: string;
      otorgadoPorId: string | null;
      motivo: string | null;
      venceEn: Date | null;
    },
    transaction?: Transaction,
  ): Promise<ExpedienteConcesionModel> {
    return this.concesiones.create(values, { transaction });
  }

  /** Concesiones vigentes sobre un conjunto de nodos (el nodo y sus ancestros). */
  findConcesionesVigentes(tenantId: string, nodoIds: readonly string[]): Promise<ExpedienteConcesionModel[]> {
    if (nodoIds.length === 0) return Promise.resolve([]);
    return this.concesiones.findAll({
      where: {
        tenantId,
        nodoId: { [Op.in]: nodoIds },
        revocadoEn: null as unknown as Date,
        [Op.or]: [{ venceEn: null }, { venceEn: { [Op.gt]: new Date() } }],
      },
    });
  }

  findConcesion(tenantId: string, id: string): Promise<ExpedienteConcesionModel | null> {
    return this.concesiones.findOne({ where: { tenantId, id } });
  }

  async revocarConcesion(tenantId: string, id: string, porId: string | null): Promise<void> {
    await this.concesiones.update({ revocadoEn: new Date(), revocadoPorId: porId }, { where: { tenantId, id } });
  }

  // ---------------------------------------------------------------- tickets

  crearTicket(
    values: {
      tenantId: string;
      expedienteId: string;
      parentId: string | null;
      nombrePrevisto: string;
      mimeType: string;
      sizeBytes: string;
      sha256Declarado: string | null;
      storageKey: string;
      emitidoPorId: string | null;
      venceEn: Date;
    },
  ): Promise<ExpedienteTicketSubidaModel> {
    return this.tickets.create(values);
  }

  findTicket(tenantId: string, id: string): Promise<ExpedienteTicketSubidaModel | null> {
    return this.tickets.findOne({ where: { tenantId, id } });
  }

  async consumirTicket(tenantId: string, id: string, transaction?: Transaction): Promise<void> {
    await this.tickets.update({ consumidoEn: new Date() }, { where: { tenantId, id }, transaction });
  }

  findTicketsVencidos(limite: number): Promise<ExpedienteTicketSubidaModel[]> {
    return this.tickets.findAll({
      where: { consumidoEn: null as unknown as Date, venceEn: { [Op.lt]: new Date() } },
      limit: limite,
    });
  }

  async borrarTicket(id: string): Promise<void> {
    await this.tickets.destroy({ where: { id } });
  }
}
