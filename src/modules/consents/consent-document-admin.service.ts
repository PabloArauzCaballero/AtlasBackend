/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza permite corregir y publicar lo que el cliente acepta, sin perder lo ya aceptado.
 * @system administra el catálogo de documentos de consentimiento y su vigencia.
 */
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { ConsentDocumentModel } from '../../database/models/index.js';
import { toConsentDocumentResponse } from './consents.mapper.js';
import { CreateConsentDocumentDto, UpdateConsentDocumentDto } from './consents.schemas.js';

/**
 * Publicar y corregir documentos de consentimiento.
 *
 * ## La regla que gobierna todo esto
 *
 * **Una versión publicada no cambia de significado.** Se puede corregir una errata, pero no se puede
 * reescribir lo que decía: quien aceptó bajo la v1 tiene derecho a que la v1 siga diciendo lo que
 * leyó. Un cambio de fondo es una versión nueva, y eso obliga a volver a pedir la aceptación.
 *
 * Por eso `update` no toca ni el código ni la versión, y `publish` retira la anterior en vez de
 * sobrescribirla.
 */
@Injectable()
export class ConsentDocumentAdminService {
  private readonly logger = new Logger(ConsentDocumentAdminService.name);

  constructor(@InjectModel(ConsentDocumentModel) private readonly documents: typeof ConsentDocumentModel) {}

  async list(tenantId: string) {
    const rows = await this.documents.findAll({
      where: { tenantId },
      order: [
        ['documentCode', 'ASC'],
        ['effectiveFrom', 'DESC'],
      ],
    } as FindOptions);
    return { items: rows.map(toConsentDocumentResponse) };
  }

  /**
   * Publica una versión nueva y retira la anterior del mismo código e idioma.
   *
   * Las dos cosas van juntas a propósito. Publicar sin retirar dejaría dos versiones activas del
   * mismo documento, y entonces «la política vigente» dejaría de ser una sola cosa — la app tendría
   * que elegir, y elegiría por orden de consulta.
   */
  async publish(tenantId: string, input: CreateConsentDocumentDto, internalUserId: string | null) {
    const duplicate = await this.documents.findOne({
      where: { tenantId, documentCode: input.documentCode, versionCode: input.versionCode, language: input.language },
    } as FindOptions);
    if (duplicate) throw new ConflictException('CONSENT_VERSION_ALREADY_EXISTS');

    const now = new Date();

    await this.documents.update(
      { status: 'retired', effectiveUntil: input.effectiveFrom, updatedAtValue: now },
      {
        where: {
          tenantId,
          documentCode: input.documentCode,
          language: input.language,
          status: 'published',
          [Op.and]: [{ versionCode: { [Op.ne]: input.versionCode } }],
        },
      },
    );

    const created = await this.documents.create({
      tenantId,
      documentCode: input.documentCode,
      versionCode: input.versionCode,
      language: input.language,
      title: input.title,
      summary: input.summary ?? null,
      bodyMd: input.bodyMarkdown,
      contentUrl: input.contentUrl ?? null,
      requiresExplicitAction: input.requiresExplicitAction,
      effectiveFrom: input.effectiveFrom,
      status: 'published',
      publishedByInternalUserId: internalUserId,
      publishedAt: now,
      createdAtValue: now,
    } as never);

    this.logger.log(
      `Consentimiento publicado: ${input.documentCode} ${input.versionCode} (${input.language}) por ${internalUserId ?? 'sin-usuario'}`,
    );
    return toConsentDocumentResponse(created);
  }

  /**
   * Corrige el texto de un documento existente.
   *
   * No admite cambiar `documentCode` ni `versionCode`: son la identidad de lo que alguien acepto. Lo
   * que se corrige aqui son erratas y aclaraciones; un cambio de fondo se publica como version nueva.
   */
  async update(tenantId: string, documentId: string, input: UpdateConsentDocumentDto, internalUserId: string | null) {
    const document = await this.documents.findOne({ where: { tenantId, id: documentId } } as FindOptions);
    if (!document) throw new NotFoundException('CONSENT_DOCUMENT_NOT_FOUND');

    const now = new Date();
    Object.assign(document, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.bodyMarkdown !== undefined ? { bodyMd: input.bodyMarkdown } : {}),
      ...(input.contentUrl !== undefined ? { contentUrl: input.contentUrl } : {}),
      ...(input.requiresExplicitAction !== undefined ? { requiresExplicitAction: input.requiresExplicitAction } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      publishedByInternalUserId: internalUserId,
      updatedAtValue: now,
    });
    await document.save();

    this.logger.log(`Consentimiento corregido: id=${documentId} por ${internalUserId ?? 'sin-usuario'}`);
    return toConsentDocumentResponse(document);
  }
}
