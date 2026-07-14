import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { env } from '../../config/env.js';
import { ResilientAdapterExecutorService } from '../../common/resilience/resilient-adapter-executor.service.js';
import { getJson, postJson } from '../notifications/adapters/http-adapter.util.js';
import { MAIL_TEMPLATE_DEFINITIONS, MailTemplateDefinition, MailTemplateName } from './mail-sender.templates.js';

/** Margen sobre el JWT_EXPIRES_IN=1h de MailSender para nunca usar un token administrativo al borde de expirar. */
const ADMIN_TOKEN_CACHE_MS = 45 * 60 * 1000;

export class MailSenderDeliveryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MailSenderDeliveryError';
  }
}

export type SendTemplateEmailInput = {
  template: MailTemplateName;
  to: string;
  recipientName: string | null;
  /** `moduloOrigen` en MailSender: identifica qué módulo de ATLAS originó el envío. */
  sourceModule: string;
  /** `referenciaOrigen` en MailSender: correlaciona el envío con la operación de negocio. */
  reference: string;
  variables: Record<string, string>;
};

/**
 * Conector HTTP real hacia el microservicio MailSender (proyecto hermano, Express + SendGrid).
 * Contrato consumido (ver MailSender/docs/endpoints/endpoints.md):
 * - `POST /auth/token` (username/password administrativos) para gestionar plantillas.
 * - `GET/POST /templates` para resolver/auto-provisionar las plantillas de ATLAS por nombre.
 * - `POST /messages/send` (header `x-api-key`) para encolar el envío real.
 */
@Injectable()
export class MailSenderClient {
  private readonly logger = new Logger(MailSenderClient.name);
  private adminToken: { value: string; expiresAtMs: number } | null = null;
  private readonly templateIdsByName = new Map<MailTemplateName, string>();
  private readonly templateResolutionsInFlight = new Map<MailTemplateName, Promise<string>>();

  constructor(private readonly executor: ResilientAdapterExecutorService) {}

  isConfigured(): boolean {
    return Boolean(
      env.MAILSENDER_BASE_URL && env.MAILSENDER_EXTERNAL_API_KEY && env.MAILSENDER_ADMIN_USERNAME && env.MAILSENDER_ADMIN_PASSWORD,
    );
  }

  async sendTemplateEmail(input: SendTemplateEmailInput): Promise<{ trackingId: string }> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('El servicio de correo (MailSender) no está configurado.');
    }

    const plantillaId = await this.ensureTemplateId(MAIL_TEMPLATE_DEFINITIONS[input.template]);
    const response = await postJson(
      this.executor,
      'mailsender',
      this.apiUrl('/messages/send'),
      { 'x-api-key': env.MAILSENDER_EXTERNAL_API_KEY as string },
      {
        canal: 'EMAIL',
        plantillaId,
        sistemaOrigen: 'ATLAS_BACKEND',
        moduloOrigen: input.sourceModule,
        referenciaOrigen: input.reference,
        destinatarios: [
          {
            ...(input.recipientName ? { nombre: input.recipientName } : {}),
            moduloOrigen: input.sourceModule,
            contacto: input.to,
            variables: input.variables,
          },
        ],
      },
    );

    if (!response.ok) {
      this.logger.error(`MailSender rechazó el envío de "${input.template}" (HTTP ${response.status}): ${JSON.stringify(response.json)}`);
      throw new MailSenderDeliveryError('MAILSENDER_SEND_FAILED', `MailSender respondió HTTP ${response.status} al enviar el correo.`);
    }

    const data = this.dataFrom(response.json);
    return { trackingId: String(data.trackingId ?? '') };
  }

  /**
   * Resuelve el UUID de la plantilla por nombre, creándola si aún no existe (idempotente por el
   * cache y por la promesa in-flight: envíos concurrentes del mismo template comparten una única
   * resolución y no crean plantillas duplicadas).
   */
  private async ensureTemplateId(definition: MailTemplateDefinition): Promise<string> {
    const cached = this.templateIdsByName.get(definition.nombre);
    if (cached) return cached;

    const inFlight = this.templateResolutionsInFlight.get(definition.nombre);
    if (inFlight) return inFlight;

    const resolution = this.resolveTemplateId(definition).finally(() => this.templateResolutionsInFlight.delete(definition.nombre));
    this.templateResolutionsInFlight.set(definition.nombre, resolution);
    return resolution;
  }

  private async resolveTemplateId(definition: MailTemplateDefinition): Promise<string> {
    const token = await this.getAdminToken();

    const list = await this.withTokenRetry(token, (bearer) =>
      getJson(this.executor, 'mailsender', this.apiUrl('/templates?canal=EMAIL'), { authorization: `Bearer ${bearer}` }),
    );
    if (!list.ok) {
      throw new MailSenderDeliveryError('MAILSENDER_TEMPLATES_UNAVAILABLE', `MailSender respondió HTTP ${list.status} al listar plantillas.`);
    }

    const templates = Array.isArray(list.json.data) ? (list.json.data as Array<Record<string, unknown>>) : [];
    const existing = templates.find((template) => template.nombre === definition.nombre && typeof template.id === 'string');
    if (existing) {
      this.templateIdsByName.set(definition.nombre, existing.id as string);
      return existing.id as string;
    }

    const created = await this.withTokenRetry(token, (bearer) =>
      postJson(
        this.executor,
        'mailsender',
        this.apiUrl('/templates'),
        { authorization: `Bearer ${bearer}` },
        {
          canal: 'EMAIL',
          nombre: definition.nombre,
          descripcion: definition.descripcion,
          estado: 'ACTIVE',
          emailAsunto: definition.emailAsunto,
          emailHtmlBody: definition.emailHtmlBody,
          emailTextBody: definition.emailTextBody,
          variablesRequeridas: [...definition.variablesRequeridas],
        },
      ),
    );
    const createdId = this.dataFrom(created.json).id;
    if (!created.ok || typeof createdId !== 'string') {
      throw new MailSenderDeliveryError(
        'MAILSENDER_TEMPLATE_PROVISION_FAILED',
        `MailSender respondió HTTP ${created.status} al crear la plantilla "${definition.nombre}".`,
      );
    }

    this.logger.log(`Plantilla "${definition.nombre}" auto-provisionada en MailSender (id ${createdId}).`);
    this.templateIdsByName.set(definition.nombre, createdId);
    return createdId;
  }

  /** Reintenta una única vez con token fresco si MailSender respondió 401 (token administrativo vencido/rotado). */
  private async withTokenRetry(
    token: string,
    call: (bearer: string) => Promise<{ ok: boolean; status: number; json: Record<string, unknown> }>,
  ): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const response = await call(token);
    if (response.status !== 401) return response;
    this.adminToken = null;
    return call(await this.getAdminToken());
  }

  private async getAdminToken(): Promise<string> {
    if (this.adminToken && this.adminToken.expiresAtMs > Date.now()) {
      return this.adminToken.value;
    }

    const response = await postJson(
      this.executor,
      'mailsender',
      this.apiUrl('/auth/token'),
      {},
      { username: env.MAILSENDER_ADMIN_USERNAME, password: env.MAILSENDER_ADMIN_PASSWORD },
    );
    const accessToken = this.dataFrom(response.json).accessToken;
    if (!response.ok || typeof accessToken !== 'string') {
      throw new MailSenderDeliveryError('MAILSENDER_AUTH_FAILED', `MailSender respondió HTTP ${response.status} al emitir el JWT administrativo.`);
    }

    this.adminToken = { value: accessToken, expiresAtMs: Date.now() + ADMIN_TOKEN_CACHE_MS };
    return accessToken;
  }

  private apiUrl(path: string): string {
    const base = (env.MAILSENDER_BASE_URL ?? '').replace(/\/+$/, '');
    return `${base}${env.MAILSENDER_API_PREFIX}${path}`;
  }

  private dataFrom(json: Record<string, unknown>): Record<string, unknown> {
    return json.data && typeof json.data === 'object' ? (json.data as Record<string, unknown>) : {};
  }
}
