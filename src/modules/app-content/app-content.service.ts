/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza saca del código lo que el cliente lee en la app y lo pone donde se edita.
 * @system lee y escribe el catálogo de contenidos de la app, y arma la acción de cada pieza.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions } from 'sequelize';
import { AppContentEntryModel } from '../../database/models/index.js';
import type { ContentSurface, UpsertContentDto } from './app-content.types.js';

/** Prefijo internacional de Bolivia. El portal guarda el número local; el enlace lo arma el servidor. */
const BOLIVIA_DIALING_CODE = '591';

@Injectable()
export class AppContentService {
  constructor(@InjectModel(AppContentEntryModel) private readonly entries: typeof AppContentEntryModel) {}

  /**
   * Lo que la app pinta, ya resuelto.
   *
   * Devuelve la acción como URL lista para abrir en lugar del número suelto: componer
   * `https://wa.me/591…` en el cliente significaría que el prefijo del país vive en la app, y
   * cambiarlo —o soportar un segundo país— obligaría a publicar en las tiendas. Aquí lo arma quien
   * ya conoce el tenant.
   */
  async listPublic(tenantId: string, input: { surface?: ContentSurface; locale: string }) {
    const rows = await this.entries.findAll({
      where: {
        tenantId,
        isActive: true,
        deleted: false,
        locale: input.locale,
        ...(input.surface ? { surface: input.surface } : {}),
      },
      order: [
        ['surface', 'ASC'],
        ['displayOrder', 'ASC'],
        ['contentKey', 'ASC'],
      ],
    } as FindOptions);

    return { items: rows.map((row) => this.toPublic(row)) };
  }

  async listForAdmin(tenantId: string, input: { surface?: ContentSurface }) {
    const rows = await this.entries.findAll({
      where: { tenantId, deleted: false, ...(input.surface ? { surface: input.surface } : {}) },
      order: [
        ['surface', 'ASC'],
        ['displayOrder', 'ASC'],
        ['contentKey', 'ASC'],
      ],
    } as FindOptions);
    return { items: rows.map((row) => this.toAdmin(row)) };
  }

  async upsert(tenantId: string, body: UpsertContentDto, internalUserId: string | null) {
    const now = new Date();
    const existing = await this.entries.findOne({
      where: { tenantId, surface: body.surface, contentKey: body.contentKey, locale: body.locale, deleted: false },
    } as FindOptions);

    const values = {
      title: body.title ?? null,
      subtitle: body.subtitle ?? null,
      bodyMd: body.bodyMd ?? null,
      bulletsJson: body.bullets ?? null,
      metadataJson: body.metadata ?? null,
      actionKind: body.actionKind ?? null,
      actionLabel: body.actionLabel ?? null,
      actionValue: body.actionValue ?? null,
      displayOrder: body.displayOrder,
      isActive: body.isActive,
      updatedByInternalUserId: internalUserId,
      updatedAtValue: now,
    };

    if (existing) {
      Object.assign(existing, values);
      // `published_at` marca la primera vez que el contenido se hizo visible, no la última edición:
      // es lo que permite responder «desde cuándo se le enseñó esto a la gente».
      if (body.isActive && !existing.publishedAt) existing.publishedAt = now;
      await existing.save();
      return this.toAdmin(existing);
    }

    const created = await this.entries.create({
      tenantId,
      surface: body.surface,
      contentKey: body.contentKey,
      locale: body.locale,
      ...values,
      publishedAt: body.isActive ? now : null,
      createdAtValue: now,
      deleted: false,
    } as never);
    return this.toAdmin(created);
  }

  async remove(tenantId: string, contentId: string) {
    const entry = await this.entries.findOne({ where: { id: contentId, tenantId, deleted: false } } as FindOptions);
    if (!entry) throw new NotFoundException('APP_CONTENT_NOT_FOUND');
    // Borrado lógico: el contenido que alguien leyó es evidencia de qué se le dijo y cuándo, y en un
    // producto de crédito esa pregunta se hace tarde y en serio.
    entry.deleted = true;
    entry.isActive = false;
    entry.updatedAtValue = new Date();
    await entry.save();
    return { contentId, removed: true };
  }

  private toPublic(row: AppContentEntryModel) {
    return {
      contentKey: row.contentKey,
      surface: row.surface,
      title: row.title,
      subtitle: row.subtitle,
      body: row.bodyMd,
      bullets: row.bulletsJson ?? [],
      metadata: row.metadataJson ?? {},
      action: this.resolveAction(row),
      displayOrder: row.displayOrder,
    };
  }

  private toAdmin(row: AppContentEntryModel) {
    return {
      contentId: row.id,
      surface: row.surface,
      contentKey: row.contentKey,
      locale: row.locale,
      title: row.title,
      subtitle: row.subtitle,
      bodyMd: row.bodyMd,
      bullets: row.bulletsJson ?? [],
      metadata: row.metadataJson ?? {},
      actionKind: row.actionKind,
      actionLabel: row.actionLabel,
      actionValue: row.actionValue,
      resolvedAction: this.resolveAction(row),
      displayOrder: row.displayOrder,
      isActive: row.isActive,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      updatedAt: row.updatedAtValue?.toISOString() ?? null,
    };
  }

  private resolveAction(row: AppContentEntryModel): { kind: string; label: string; url: string } | null {
    if (!row.actionKind || !row.actionLabel || !row.actionValue) return null;
    if (row.actionKind !== 'whatsapp') return { kind: row.actionKind, label: row.actionLabel, url: row.actionValue };

    const digits = row.actionValue.replace(/\D/g, '');
    // Un número boliviano local son 8 dígitos. Si ya viene con prefijo se respeta: el portal puede
    // guardar un número de otro país sin que este código tenga que enterarse.
    const withCode = digits.length <= 8 ? `${BOLIVIA_DIALING_CODE}${digits}` : digits;
    const message = typeof row.metadataJson?.whatsappMessage === 'string' ? row.metadataJson.whatsappMessage : null;
    const query = message ? `?text=${encodeURIComponent(message)}` : '';
    return { kind: 'whatsapp', label: row.actionLabel, url: `https://wa.me/${withCode}${query}` };
  }
}
