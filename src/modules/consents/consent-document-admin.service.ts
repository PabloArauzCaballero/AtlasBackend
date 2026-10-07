/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza permite corregir y publicar lo que el cliente acepta, sin perder lo ya aceptado.
 * @system administra el catálogo de documentos de consentimiento y su vigencia.
 */
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op, Transaction } from 'sequelize';
import { buildPaginationMeta, toOffset } from '../../common/utils/pagination/pagination.util.js';
import { withTextSearch } from '../../common/utils/query/text-search.util.js';
import { ConsentDocumentModel } from '../../database/models/index.js';
import { toConsentDocumentResponse } from './consents.mapper.js';
import { CreateConsentDocumentDto, ListConsentDocumentsQueryDto, UpdateConsentDocumentDto } from './consents.schemas.js';

/**
 * Publicar y corregir documentos de consentimiento.
 *
 * ## La regla que gobierna todo esto
 *
 * **Una versión publicada no cambia de significado.** Se puede corregir una errata, pero no se puede
 * reescribir lo que decía: quien aceptó bajo la v1 tiene derecho a que la v1 siga diciendo lo que
 * leyó. Un cambio de fondo es una versión nueva, y eso obliga a volver a pedir la aceptación.
 *
 * Por eso `update` no toca ni el código ni la versión, ni el texto de una versión que ya salió, y
 * `publish` retira la anterior en vez de sobrescribirla.
 */
@Injectable()
export class ConsentDocumentAdminService {
  private readonly logger = new Logger(ConsentDocumentAdminService.name);

  constructor(@InjectModel(ConsentDocumentModel) private readonly documents: typeof ConsentDocumentModel) {}

  /**
   * La página del portal, filtrada y paginada en el servidor. El `summary` cuenta el catálogo
   * entero del tenant —vigentes, borradores y retirados—, no la página ni el filtro, para que las
   * cifras no cambien al buscar.
   */
  async list(tenantId: string, query: ListConsentDocumentsQueryDto) {
    const where: Record<string | symbol, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    withTextSearch(where, query.q, ['documentCode', 'title', 'summary']);
    const [found, published, draft, retired] = await Promise.all([
      this.documents.findAndCountAll({
        where,
        order: [
          ['documentCode', 'ASC'],
          ['effectiveFrom', 'DESC'],
        ],
        limit: query.limit,
        offset: toOffset(query),
      } as FindOptions),
      this.documents.count({ where: { tenantId, status: 'published' } } as FindOptions),
      this.documents.count({ where: { tenantId, status: 'draft' } } as FindOptions),
      this.documents.count({ where: { tenantId, status: 'retired' } } as FindOptions),
    ]);
    return {
      items: found.rows.map(toConsentDocumentResponse),
      meta: buildPaginationMeta(query, found.count),
      summary: { total: published + draft + retired, published, draft, retired },
    };
  }

  /**
   * Publica una versión nueva y retira la anterior del mismo código e idioma.
   *
   * Las dos cosas van juntas a propósito —y en UNA transacción—. Publicar sin retirar dejaría dos
   * versiones activas del mismo documento, y entonces «la política vigente» dejaría de ser una sola
   * cosa; retirar sin llegar a publicar deja el código sin ninguna.
   *
   * ## Una versión con fecha futura no retira la vigente hoy
   *
   * Todas las lecturas exigen `status = 'published'` y la ventana de vigencia. Retirar la anterior
   * al programar la nueva dejaba el código SIN versión vigente hasta esa fecha, y el alta pasaba sin
   * exigir un consentimiento obligatorio. La anterior sigue publicada con `effectiveUntil` = el
   * inicio de la nueva: la ventana hace el relevo sola, el día que toca.
   */
  async publish(tenantId: string, input: CreateConsentDocumentDto, internalUserId: string | null) {
    const now = new Date();
    const programada = new Date(`${input.effectiveFrom}T00:00:00.000Z`).getTime() > now.getTime();

    const created = await this.transaction(async (transaction) => {
      const duplicate = await this.documents.findOne({
        where: { tenantId, documentCode: input.documentCode, versionCode: input.versionCode, language: input.language },
        transaction,
      } as FindOptions);
      if (duplicate) throw new ConflictException('CONSENT_VERSION_ALREADY_EXISTS');

      const anteriores = {
        tenantId,
        documentCode: input.documentCode,
        language: input.language,
        status: 'published',
        versionCode: { [Op.ne]: input.versionCode },
      };
      await this.documents.update(
        programada
          ? { effectiveUntil: input.effectiveFrom, updatedAtValue: now }
          : { status: 'retired', effectiveUntil: input.effectiveFrom, updatedAtValue: now },
        {
          // Programada: sólo se ACORTA la vigencia; una que ya terminaba antes se queda como estaba.
          where: programada
            ? { ...anteriores, [Op.or]: [{ effectiveUntil: null }, { effectiveUntil: { [Op.gt]: input.effectiveFrom } }] }
            : anteriores,
          transaction,
        },
      );

      return this.documents.create(
        {
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
        } as never,
        { transaction },
      );
    });

    this.logger.log(
      `Consentimiento publicado: ${input.documentCode} ${input.versionCode} (${input.language}) por ${internalUserId ?? 'sin-usuario'}`,
    );
    return toConsentDocumentResponse(created);
  }

  /**
   * Corrige un documento existente.
   *
   * No admite cambiar `documentCode` ni `versionCode`: son la identidad de lo que alguien acepto.
   *
   * Una version que ya salio (`published` o `retired`) es evidencia: su cuerpo, su URL y si exige
   * accion explicita NO se cambian —los `customer_consents` apuntan a ella y no guardan copia del
   * texto—; solo se corrigen erratas del titulo y del resumen, o se retira. Tampoco se publica desde
   * aqui: reactivar una retirada dejaria dos vigentes del mismo codigo. Un cambio de fondo es una
   * version nueva, con `publish`. Reenviar el MISMO valor no es un cambio y se acepta.
   */
  async update(tenantId: string, documentId: string, input: UpdateConsentDocumentDto, internalUserId: string | null) {
    const document = await this.documents.findOne({ where: { tenantId, id: documentId } } as FindOptions);
    if (!document) throw new NotFoundException('CONSENT_DOCUMENT_NOT_FOUND');

    assertCorrectable(document, input);

    // `publishedByInternalUserId` NO se toca: es quien publico la version, no quien corrigio una errata.
    Object.assign(document, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(cambia(input.bodyMarkdown, document.bodyMd?.trim() ?? null) ? { bodyMd: input.bodyMarkdown } : {}),
      ...(input.contentUrl !== undefined ? { contentUrl: input.contentUrl } : {}),
      ...(input.requiresExplicitAction !== undefined ? { requiresExplicitAction: input.requiresExplicitAction } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedAtValue: new Date(),
    });
    await document.save();

    this.logger.log(`Consentimiento corregido: id=${documentId} estado=${document.status} por ${internalUserId ?? 'sin-usuario'}`);
    return toConsentDocumentResponse(document);
  }

  private transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    const sequelize = this.documents.sequelize;
    if (!sequelize) throw new Error('ConsentDocumentModel no está registrado en una conexión.');
    return sequelize.transaction(work);
  }
}

const cambia = <T>(nuevo: T | undefined, actual: T | null) => nuevo !== undefined && nuevo !== actual;

/** Lo que `update` no puede hacer: publicar, ni cambiar el fondo de una version que ya salio. */
function assertCorrectable(document: ConsentDocumentModel, input: UpdateConsentDocumentDto): void {
  if (input.status === 'published' && document.status !== 'published') {
    throw new ConflictException('CONSENT_DOCUMENT_PUBLISH_REQUIRES_NEW_VERSION');
  }
  if (document.status !== 'published' && document.status !== 'retired') return;
  const fondo =
    cambia(input.bodyMarkdown, document.bodyMd?.trim() ?? null) ||
    cambia(input.contentUrl, document.contentUrl) ||
    cambia(input.requiresExplicitAction, document.requiresExplicitAction);
  const reabre = cambia(input.status, document.status) && input.status !== 'retired';
  if (fondo || reabre) throw new ConflictException('CONSENT_DOCUMENT_PUBLISHED_IS_IMMUTABLE');
}
