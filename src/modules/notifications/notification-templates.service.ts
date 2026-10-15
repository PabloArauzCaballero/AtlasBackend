/**
 * @file Servicio de aplicación: alta y consulta de plantillas de notificación.
 * @business Esta pieza entrega mensajes oportunos y respetuosos de preferencias por canales configurables.
 * @system orquesta reglas, plantillas, audiencias, persistencia y adaptadores multicanal resilientes.
 */
import { Injectable } from '@nestjs/common';
import { NotificationTemplatesRepository } from './notification-templates.repository.js';
import { paginate } from './notification-pagination.util.js';
import { CreateTemplateDto, ListTemplatesQueryDto, UpdateTemplateDto } from './notifications.schemas.js';
import { mapTemplate } from './notifications.mapper.js';

@Injectable()
export class NotificationTemplatesService {
  constructor(private readonly templates: NotificationTemplatesRepository) {}

  async listTemplates(tenantId: string, query: ListTemplatesQueryDto) {
    const result = await this.templates.listTemplates(tenantId, query);
    return paginate(result.rows, result.count, query, mapTemplate);
  }

  async createTemplate(tenantId: string, body: CreateTemplateDto) {
    return mapTemplate(await this.templates.createTemplate(tenantId, body));
  }

  async updateTemplate(tenantId: string, templateId: string, body: UpdateTemplateDto) {
    return mapTemplate(await this.templates.updateTemplate(tenantId, templateId, body));
  }
}
