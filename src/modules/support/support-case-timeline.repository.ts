/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Guarda quién fue responsable, qué se prometió, cómo se resolvió y qué opinó el cliente.
 * @system escribe asignaciones, relojes de SLA, resoluciones, enlaces, referencias y encuestas.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { CreationAttributes, Op, Transaction } from 'sequelize';
import {
  SupportAssignmentModel,
  SupportCaseFeedbackModel,
  SupportCaseLinkModel,
  SupportCaseReferenceModel,
  SupportResolutionModel,
  SupportSlaClockModel,
} from '../../database/models/index.js';

export type RepositoryOptions = { transaction?: Transaction };

@Injectable()
export class SupportCaseTimelineRepository {
  constructor(
    @InjectModel(SupportAssignmentModel) private readonly assignments: typeof SupportAssignmentModel,
    @InjectModel(SupportSlaClockModel) private readonly clocks: typeof SupportSlaClockModel,
    @InjectModel(SupportResolutionModel) private readonly resolutions: typeof SupportResolutionModel,
    @InjectModel(SupportCaseLinkModel) private readonly links: typeof SupportCaseLinkModel,
    @InjectModel(SupportCaseReferenceModel) private readonly references: typeof SupportCaseReferenceModel,
    @InjectModel(SupportCaseFeedbackModel) private readonly feedback: typeof SupportCaseFeedbackModel,
  ) {}

  findLiveAssignment(caseId: string, options: RepositoryOptions = {}): Promise<SupportAssignmentModel | null> {
    return this.assignments.findOne({
      where: { caseId, releasedAt: null },
      order: [['assigned_at', 'DESC']],
      transaction: options.transaction,
    });
  }

  /**
   * Cierra la responsabilidad anterior antes de abrir la nueva.
   *
   * El orden importa: el índice parcial de la base impone una sola asignación viva por caso, así que
   * crear primero la nueva fallaría. Que falle es lo correcto —evita dos dueños— pero el servicio
   * debe liberar explícitamente, y así queda escrito POR QUÉ terminó la anterior.
   */
  async releaseLiveAssignment(caseId: string, releaseReason: string, options: RepositoryOptions = {}): Promise<void> {
    await this.assignments.update(
      { releasedAt: new Date(), releaseReason },
      { where: { caseId, releasedAt: null }, transaction: options.transaction },
    );
  }

  createAssignment(values: CreationAttributes<SupportAssignmentModel>, options: RepositoryOptions = {}): Promise<SupportAssignmentModel> {
    return this.assignments.create(values, { transaction: options.transaction });
  }

  listAssignments(caseId: string): Promise<SupportAssignmentModel[]> {
    return this.assignments.findAll({ where: { caseId }, order: [['assigned_at', 'ASC']] });
  }

  createClock(values: CreationAttributes<SupportSlaClockModel>, options: RepositoryOptions = {}): Promise<SupportSlaClockModel> {
    return this.clocks.create(values, { transaction: options.transaction });
  }

  listClocks(caseId: string, options: RepositoryOptions = {}): Promise<SupportSlaClockModel[]> {
    return this.clocks.findAll({ where: { caseId }, transaction: options.transaction });
  }

  findClock(caseId: string, metricType: string, options: RepositoryOptions = {}): Promise<SupportSlaClockModel | null> {
    return this.clocks.findOne({ where: { caseId, metricType }, transaction: options.transaction });
  }

  async updateClock(clockId: string, values: Partial<SupportSlaClockModel>, options: RepositoryOptions = {}): Promise<void> {
    await this.clocks.update({ ...values, updatedAtValue: new Date() } as Partial<SupportSlaClockModel>, {
      where: { id: clockId },
      transaction: options.transaction,
    });
  }

  /** Relojes vencidos que todavía figuran corriendo: lo que el vigilante de SLA tiene que marcar. */
  findBreachedClocks(tenantId: string, now: Date, limit = 200): Promise<SupportSlaClockModel[]> {
    return this.clocks.findAll({
      where: { tenantId, state: 'RUNNING', targetAt: { [Op.lte]: now } },
      order: [['target_at', 'ASC']],
      limit,
    });
  }

  /**
   * Los relojes que todavía corren y aún no vencen: el material del aviso previo.
   *
   * Se excluye lo ya vencido porque de eso se ocupa `findBreachedClocks`: avisar de que algo «va a
   * incumplirse» cuando ya se incumplió no es un aviso, es ruido encima de la marca.
   */
  findRunningClocks(tenantId: string, now: Date, limit = 500): Promise<SupportSlaClockModel[]> {
    return this.clocks.findAll({
      where: { tenantId, state: 'RUNNING', targetAt: { [Op.gt]: now } },
      order: [['target_at', 'ASC']],
      limit,
    });
  }

  async nextResolutionSequence(caseId: string, options: RepositoryOptions = {}): Promise<number> {
    const last = await this.resolutions.findOne({
      where: { caseId },
      order: [['resolution_sequence', 'DESC']],
      transaction: options.transaction,
    });
    return (last?.resolutionSequence ?? 0) + 1;
  }

  createResolution(values: CreationAttributes<SupportResolutionModel>, options: RepositoryOptions = {}): Promise<SupportResolutionModel> {
    return this.resolutions.create(values, { transaction: options.transaction });
  }

  findCurrentResolution(caseId: string, options: RepositoryOptions = {}): Promise<SupportResolutionModel | null> {
    return this.resolutions.findOne({
      where: { caseId, supersededAt: null },
      order: [['resolution_sequence', 'DESC']],
      transaction: options.transaction,
    });
  }

  /** Una reapertura no borra la resolución anterior: la marca como superada y conserva su texto. */
  async supersedeResolutions(caseId: string, options: RepositoryOptions = {}): Promise<void> {
    await this.resolutions.update(
      { supersededAt: new Date() },
      { where: { caseId, supersededAt: null }, transaction: options.transaction },
    );
  }

  createLink(values: CreationAttributes<SupportCaseLinkModel>, options: RepositoryOptions = {}): Promise<SupportCaseLinkModel> {
    return this.links.create(values, { transaction: options.transaction });
  }

  listLinks(caseId: string): Promise<SupportCaseLinkModel[]> {
    return this.links.findAll({ where: { [Op.or]: [{ caseId }, { linkedCaseId: caseId }] } });
  }

  createReference(
    values: CreationAttributes<SupportCaseReferenceModel>,
    options: RepositoryOptions = {},
  ): Promise<SupportCaseReferenceModel> {
    return this.references.create(values, { transaction: options.transaction });
  }

  listReferences(caseId: string): Promise<SupportCaseReferenceModel[]> {
    return this.references.findAll({ where: { caseId }, order: [['_created_at', 'ASC']] });
  }

  findFeedback(caseId: string, respondentActorType: string, respondentActorId: string): Promise<SupportCaseFeedbackModel | null> {
    return this.feedback.findOne({ where: { caseId, respondentActorType, respondentActorId } });
  }

  createFeedback(values: CreationAttributes<SupportCaseFeedbackModel>, options: RepositoryOptions = {}): Promise<SupportCaseFeedbackModel> {
    return this.feedback.create(values, { transaction: options.transaction });
  }
}
