/**
 * @file Puerto de persistencia: encapsula consultas, locks y escrituras.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, WhereOptions } from 'sequelize';
import { NotificationTemplateModel } from '../../database/models/index.js';
import { NotificationChannel } from './notification-types.js';
import { CreateTemplateDto, ListTemplatesQueryDto, UpdateTemplateDto } from './notifications.schemas.js';

// Las plantillas son casi estáticas pero `findTemplate` se consultaba por cada mensaje del outbox
// (N mensajes × M canales). Caché en memoria con TTL corto para evitar el round-trip repetido. Se
// invalida por completo ante cualquier create/update (son raros); el TTL acota además la ventana de
// inconsistencia si una réplica escribe una plantilla sin pasar por esta instancia.
const TEMPLATE_CACHE_TTL_MS = 60_000;

type CachedTemplate = { value: NotificationTemplateModel | null; expiresAt: number };

/**
 * Repositorio del agregado de PLANTILLAS de notificación (Fase 2.3 del plan 10/10). Toca
 * EXCLUSIVAMENTE `notification_templates` — sin acceso a mensajes, entregas, preferencias, tokens de
 * dispositivo ni contactos. `NotificationsRepository` delega en él para conservar su API pública.
 *
 * Resolución de plantilla: primero la del tenant, y si no existe cae a la global (`tenantId: null`),
 * siempre la versión más alta activa para ese `code`+`channel`+`locale`.
 */
@Injectable()
export class NotificationTemplatesRepository {
  private readonly cache = new Map<string, CachedTemplate>();

  constructor(@InjectModel(NotificationTemplateModel) private readonly templateModel: typeof NotificationTemplateModel) {}

  async findTemplate(input: {
    tenantId: string | null;
    code: string;
    channel: NotificationChannel;
    locale?: string;
  }): Promise<NotificationTemplateModel | null> {
    const locale = input.locale ?? 'es-BO';
    const cacheKey = `${input.tenantId ?? 'GLOBAL'}|${input.code}|${input.channel}|${locale}`;
    const cached = this.cache.get(cacheKey);
    // No se usa Date.now dentro de scripts de workflow, pero aquí es runtime normal de la app.
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.value;

    const tenantTemplate = input.tenantId
      ? await this.templateModel.findOne({
          where: { tenantId: input.tenantId, code: input.code, channel: input.channel, locale, isActive: true },
          order: [['version', 'DESC']],
        })
      : null;
    const resolved =
      tenantTemplate ??
      (await this.templateModel.findOne({
        where: { tenantId: null, code: input.code, channel: input.channel, locale, isActive: true },
        order: [['version', 'DESC']],
      }));
    this.cache.set(cacheKey, { value: resolved, expiresAt: now + TEMPLATE_CACHE_TTL_MS });
    return resolved;
  }

  /** Invalida toda la caché de resolución. Se llama tras cualquier escritura de plantilla. */
  private invalidateCache(): void {
    this.cache.clear();
  }

  async listTemplates(tenantId: string, query: ListTemplatesQueryDto) {
    const where: WhereOptions = { [Op.or]: [{ tenantId }, { tenantId: null }] } as never;
    if (query.code) (where as Record<string, unknown>).code = query.code;
    if (query.channel) (where as Record<string, unknown>).channel = query.channel;
    if (query.active !== undefined) (where as Record<string, unknown>).isActive = query.active;
    return this.templateModel.findAndCountAll({
      where,
      order: [
        ['code', 'ASC'],
        ['channel', 'ASC'],
        ['version', 'DESC'],
      ],
      offset: (query.page - 1) * query.limit,
      limit: query.limit,
    });
  }

  async createTemplate(tenantId: string, body: CreateTemplateDto): Promise<NotificationTemplateModel> {
    const now = new Date();
    const created = await this.templateModel.create({
      tenantId,
      code: body.code,
      channel: body.channel,
      locale: body.locale,
      titleTemplate: body.titleTemplate ?? null,
      subjectTemplate: body.subjectTemplate ?? null,
      bodyTemplate: body.bodyTemplate,
      payloadSchemaJson: body.payloadSchema ?? null,
      category: body.category ?? null,
      icon: body.icon ?? null,
      isActive: body.isActive,
      version: body.version,
      createdAtValue: now,
      updatedAtValue: now,
    });
    this.invalidateCache();
    return created;
  }

  async updateTemplate(tenantId: string, templateId: string, body: UpdateTemplateDto): Promise<NotificationTemplateModel> {
    const template = await this.templateModel.findOne({ where: { tenantId, id: templateId } });
    if (!template) throw new NotFoundException('NOTIFICATION_TEMPLATE_NOT_FOUND');
    if (body.code !== undefined) template.code = body.code;
    if (body.channel !== undefined) template.channel = body.channel;
    if (body.locale !== undefined) template.locale = body.locale;
    if (body.titleTemplate !== undefined) template.titleTemplate = body.titleTemplate ?? null;
    if (body.subjectTemplate !== undefined) template.subjectTemplate = body.subjectTemplate ?? null;
    if (body.bodyTemplate !== undefined) template.bodyTemplate = body.bodyTemplate;
    if (body.payloadSchema !== undefined) template.payloadSchemaJson = body.payloadSchema ?? null;
    if (body.category !== undefined) template.category = body.category ?? null;
    if (body.icon !== undefined) template.icon = body.icon ?? null;
    if (body.isActive !== undefined) template.isActive = body.isActive;
    if (body.version !== undefined) template.version = body.version;
    template.updatedAtValue = new Date();
    await template.save();
    this.invalidateCache();
    return template;
  }
}
