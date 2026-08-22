/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza declara qué avisos existen y cuáles el cliente no puede apagar.
 * @system lee y escribe el catálogo de políticas de notificación por evento y canal.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import { NotificationPolicyModel } from '../../database/models/index.js';

/**
 * El catálogo de avisos, del lado del servidor.
 *
 * Antes la obligatoriedad de un aviso llegaba en el cuerpo de la petición del cliente: bastaba
 * mandar `isRequired: false` para poder apagar el recordatorio de pago y el aviso de mora. El
 * control existía y no controlaba nada. Ahora la respuesta a «¿esto se puede apagar?» sale de aquí,
 * donde la escribe operaciones y no la app.
 */
@Injectable()
export class NotificationPoliciesRepository {
  constructor(@InjectModel(NotificationPolicyModel) private readonly policyModel: typeof NotificationPolicyModel) {}

  /** Las activas, en el orden en que se pintan. Es lo que la app usa para dibujar la pantalla. */
  listActive(tenantId: string): Promise<NotificationPolicyModel[]> {
    return this.policyModel.findAll({
      where: { tenantId, isActive: true, deleted: false },
      order: [
        ['category', 'ASC'],
        ['displayOrder', 'ASC'],
        ['eventCode', 'ASC'],
      ],
    } as FindOptions);
  }

  /** Todas, activas o no: el portal interno tiene que poder reactivar una que apagó. */
  listAll(tenantId: string): Promise<NotificationPolicyModel[]> {
    return this.policyModel.findAll({
      where: { tenantId, deleted: false },
      order: [
        ['category', 'ASC'],
        ['displayOrder', 'ASC'],
        ['eventCode', 'ASC'],
      ],
    } as FindOptions);
  }

  find(tenantId: string, eventCode: string, channel: string): Promise<NotificationPolicyModel | null> {
    return this.policyModel.findOne({ where: { tenantId, eventCode, channel, deleted: false } } as FindOptions);
  }

  /**
   * Los pares evento/canal que NO se pueden apagar.
   *
   * Devuelto como conjunto porque quien lo usa —la escritura de preferencias— comprueba pertenencia
   * una vez por preferencia recibida, y una consulta por preferencia convertiría un `PATCH` de
   * veinte filas en veinte viajes a la base.
   */
  async mandatoryKeys(tenantId: string): Promise<Set<string>> {
    const mandatory = await this.policyModel.findAll({
      where: { tenantId, isMandatory: true, isActive: true, deleted: false },
      attributes: ['eventCode', 'channel'],
    } as FindOptions);
    return new Set(mandatory.map((policy) => `${policy.eventCode}:${policy.channel}`));
  }

  async upsert(input: {
    tenantId: string;
    eventCode: string;
    channel: string;
    label: string;
    description?: string | null;
    category?: string;
    icon?: string | null;
    isMandatory?: boolean;
    defaultEnabled?: boolean;
    mandatoryReason?: string | null;
    displayOrder?: number;
    isActive?: boolean;
    updatedByInternalUserId?: string | null;
  }): Promise<NotificationPolicyModel> {
    const now = new Date();
    const existing = await this.find(input.tenantId, input.eventCode, input.channel);

    if (existing) {
      existing.label = input.label;
      existing.description = input.description ?? existing.description;
      existing.category = input.category ?? existing.category;
      existing.icon = input.icon ?? existing.icon;
      existing.isMandatory = input.isMandatory ?? existing.isMandatory;
      // Un aviso obligatorio no puede quedar apagado por defecto: sería obligatorio y silencioso a
      // la vez. La base también lo impide; aquí se corrige antes de llegar a ella para que el portal
      // reciba el dato coherente en lugar de un error de restricción.
      existing.defaultEnabled = existing.isMandatory ? true : (input.defaultEnabled ?? existing.defaultEnabled);
      existing.mandatoryReason = input.mandatoryReason ?? existing.mandatoryReason;
      existing.displayOrder = input.displayOrder ?? existing.displayOrder;
      existing.isActive = input.isActive ?? existing.isActive;
      existing.updatedByInternalUserId = input.updatedByInternalUserId ?? existing.updatedByInternalUserId;
      existing.updatedAtValue = now;
      await existing.save();
      return existing;
    }

    const isMandatory = input.isMandatory ?? false;
    return this.policyModel.create({
      tenantId: input.tenantId,
      eventCode: input.eventCode,
      channel: input.channel,
      label: input.label,
      description: input.description ?? null,
      category: input.category ?? 'general',
      icon: input.icon ?? null,
      isMandatory,
      defaultEnabled: isMandatory ? true : (input.defaultEnabled ?? true),
      mandatoryReason: input.mandatoryReason ?? null,
      displayOrder: input.displayOrder ?? 100,
      isActive: input.isActive ?? true,
      updatedByInternalUserId: input.updatedByInternalUserId ?? null,
      createdAtValue: now,
      updatedAtValue: now,
      deleted: false,
    } as never);
  }

  async requireById(tenantId: string, policyId: string): Promise<NotificationPolicyModel> {
    const policy = await this.policyModel.findOne({ where: { id: policyId, tenantId, deleted: false } } as FindOptions);
    if (!policy) throw new NotFoundException('NOTIFICATION_POLICY_NOT_FOUND');
    return policy;
  }
}
