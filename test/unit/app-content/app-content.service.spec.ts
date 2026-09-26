import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { AppContentService } from '../../../src/modules/app-content/app-content.service.js';
import type { AppContentEntryModel } from '../../../src/database/models/index.js';

/**
 * El catálogo de lo que el cliente LEE dentro de la app.
 *
 * Cuatro decisiones, y ninguna se ve fallar.
 *
 * La acción viaja como URL ya armada y no como el número suelto. Componer `https://wa.me/591…` en
 * el cliente significaría que el prefijo del país vive en la app, y cambiarlo —o soportar un
 * segundo país— obligaría a publicar en las tiendas.
 *
 * Un número que YA trae prefijo se respeta: el portal puede guardar un número de otro país sin que
 * este código se entere. La regla es el largo —8 dígitos es un número boliviano local— y no una
 * lista de prefijos que habría que mantener.
 *
 * `published_at` marca la primera vez que el contenido se hizo VISIBLE, no la última edición: es lo
 * que permite responder «desde cuándo se le enseñó esto a la gente», y reescribirlo en cada guardado
 * borraría justo esa respuesta.
 *
 * Y el borrado es LÓGICO: el contenido que alguien leyó es evidencia de qué se le dijo y cuándo, y
 * en un producto de crédito esa pregunta se hace tarde y en serio.
 */
function fila(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    contentKey: 'ayuda.whatsapp',
    surface: 'home',
    locale: 'es-BO',
    title: 'Escríbenos',
    subtitle: null,
    bodyMd: null,
    bulletsJson: null,
    metadataJson: null,
    actionKind: null,
    actionLabel: null,
    actionValue: null,
    displayOrder: 1,
    isActive: true,
    publishedAt: null,
    updatedAtValue: new Date('2026-09-02T10:00:00Z'),
    save: jest.fn(async () => undefined),
    ...overrides,
  } as unknown as AppContentEntryModel;
}

describe('AppContentService', () => {
  let entries: { findAll: jest.Mock; findOne: jest.Mock; create: jest.Mock };
  let service: AppContentService;

  beforeEach(() => {
    entries = {
      findAll: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
      create: jest.fn(async (values: unknown) => fila(values as Record<string, unknown>)),
    };
    service = new AppContentService(entries as unknown as typeof AppContentEntryModel);
  });

  function ultima(mock: jest.Mock): { where: Record<string, unknown>; order?: unknown[] } {
    return mock.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> };
  }

  describe('lo que ve el cliente', () => {
    it('sólo lo ACTIVO, de su idioma y sin lo borrado', async () => {
      await service.listPublic('t1', { locale: 'es-BO' });

      expect(ultima(entries.findAll).where).toEqual({ tenantId: 't1', isActive: true, deleted: false, locale: 'es-BO' });
    });

    it('la superficie se aplica sólo cuando llega', async () => {
      await service.listPublic('t1', { locale: 'es-BO', surface: 'home' });
      expect(ultima(entries.findAll).where.surface).toBe('home');

      await service.listPublic('t1', { locale: 'es-BO' });
      expect(ultima(entries.findAll).where).not.toHaveProperty('surface');
    });

    it('el orden es el que decidió quien edita, con la clave como desempate estable', async () => {
      await service.listPublic('t1', { locale: 'es-BO' });

      expect(ultima(entries.findAll).order).toEqual([
        ['surface', 'ASC'],
        ['displayOrder', 'ASC'],
        ['contentKey', 'ASC'],
      ]);
    });

    it('las listas y los metadatos ausentes salen vacíos, no nulos: la app no comprueba', async () => {
      entries.findAll.mockResolvedValueOnce([fila()] as never);

      const { items } = await service.listPublic('t1', { locale: 'es-BO' });

      expect(items[0].bullets).toEqual([]);
      expect(items[0].metadata).toEqual({});
      expect(items[0]).not.toHaveProperty('contentId');
      expect(items[0]).not.toHaveProperty('isActive');
    });

    it('la vista de administración SÍ trae lo inactivo y sus campos de edición', async () => {
      entries.findAll.mockResolvedValueOnce([fila({ isActive: false })] as never);

      const { items } = await service.listForAdmin('t1', {});

      expect(ultima(entries.findAll).where).toEqual({ tenantId: 't1', deleted: false });
      expect(items[0]).toMatchObject({ contentId: 'c-1', isActive: false, locale: 'es-BO' });
    });
  });

  describe('la acción de una pieza', () => {
    it('sin los tres campos completos no hay acción, y no una a medias', async () => {
      for (const parcial of [
        { actionKind: 'whatsapp', actionLabel: 'Escríbenos', actionValue: null },
        { actionKind: 'whatsapp', actionLabel: null, actionValue: '70000000' },
        { actionKind: null, actionLabel: 'Escríbenos', actionValue: '70000000' },
      ]) {
        entries.findAll.mockResolvedValueOnce([fila(parcial)] as never);

        const { items } = await service.listPublic('t1', { locale: 'es-BO' });
        expect(items[0].action).toBeNull();
      }
    });

    it('un número boliviano local se completa con el prefijo del país en el SERVIDOR', async () => {
      entries.findAll.mockResolvedValueOnce([
        fila({ actionKind: 'whatsapp', actionLabel: 'Escríbenos', actionValue: '7 000-0000' }),
      ] as never);

      const { items } = await service.listPublic('t1', { locale: 'es-BO' });

      expect(items[0].action).toEqual({ kind: 'whatsapp', label: 'Escríbenos', url: 'https://wa.me/59170000000' });
    });

    it('un número que ya trae prefijo se respeta: el portal puede guardar otro país', async () => {
      entries.findAll.mockResolvedValueOnce([
        fila({ actionKind: 'whatsapp', actionLabel: 'Escríbenos', actionValue: '+34 600 123 456' }),
      ] as never);

      const { items } = await service.listPublic('t1', { locale: 'es-BO' });

      expect(items[0].action?.url).toBe('https://wa.me/34600123456');
    });

    it('el mensaje precargado viaja escapado: un `&` sin escapar partiría la URL', async () => {
      entries.findAll.mockResolvedValueOnce([
        fila({
          actionKind: 'whatsapp',
          actionLabel: 'Escríbenos',
          actionValue: '70000000',
          metadataJson: { whatsappMessage: 'Hola, quiero saber de mi crédito & mi cuota' },
        }),
      ] as never);

      const { items } = await service.listPublic('t1', { locale: 'es-BO' });

      expect(items[0].action?.url).toContain('?text=');
      expect(items[0].action?.url).toContain('%26');
      expect(items[0].action?.url).not.toContain(' ');
    });

    it('un mensaje que no es texto se ignora en vez de acabar como «[object Object]» en la URL', async () => {
      entries.findAll.mockResolvedValueOnce([
        fila({ actionKind: 'whatsapp', actionLabel: 'Escríbenos', actionValue: '70000000', metadataJson: { whatsappMessage: { a: 1 } } }),
      ] as never);

      const { items } = await service.listPublic('t1', { locale: 'es-BO' });

      expect(items[0].action?.url).toBe('https://wa.me/59170000000');
    });

    it('cualquier otra acción viaja tal cual: el prefijo es cosa de WhatsApp, no de todas', async () => {
      entries.findAll.mockResolvedValueOnce([
        fila({ actionKind: 'url', actionLabel: 'Ver más', actionValue: 'https://atlas.bo/ayuda' }),
      ] as never);

      const { items } = await service.listPublic('t1', { locale: 'es-BO' });

      expect(items[0].action).toEqual({ kind: 'url', label: 'Ver más', url: 'https://atlas.bo/ayuda' });
    });
  });

  describe('guardar', () => {
    it('una pieza nueva y activa se publica ahora', async () => {
      const dto = await service.upsert(
        't1',
        { surface: 'home', contentKey: 'k', locale: 'es-BO', displayOrder: 1, isActive: true } as never,
        '7',
      );

      const [values] = entries.create.mock.calls.at(-1) as [Record<string, unknown>];
      expect(values.publishedAt).toBeInstanceOf(Date);
      expect(values.updatedByInternalUserId).toBe('7');
      expect(dto).toHaveProperty('contentId');
    });

    it('una pieza nueva INACTIVA no se publica: nadie la ha leído todavía', async () => {
      await service.upsert('t1', { surface: 'home', contentKey: 'k', locale: 'es-BO', displayOrder: 1, isActive: false } as never, null);

      expect((entries.create.mock.calls.at(-1)?.[0] as Record<string, unknown>).publishedAt).toBeNull();
    });

    it('editar una ya publicada NO reescribe su fecha: es «desde cuándo», no «la última vez»', async () => {
      const primera = new Date('2026-01-01T00:00:00Z');
      const existente = fila({ publishedAt: primera, isActive: true });
      entries.findOne.mockResolvedValueOnce(existente as never);

      await service.upsert('t1', { surface: 'home', contentKey: 'k', locale: 'es-BO', displayOrder: 1, isActive: true } as never, '7');

      expect(existente.publishedAt).toBe(primera);
      expect(entries.create).not.toHaveBeenCalled();
      expect(existente.save).toHaveBeenCalled();
    });

    it('activar por primera vez una pieza que estaba guardada en borrador sí sella la fecha', async () => {
      const existente = fila({ publishedAt: null, isActive: false });
      entries.findOne.mockResolvedValueOnce(existente as never);

      await service.upsert('t1', { surface: 'home', contentKey: 'k', locale: 'es-BO', displayOrder: 1, isActive: true } as never, '7');

      expect(existente.publishedAt).toBeInstanceOf(Date);
    });

    it('guardar sin activar deja la fecha nula', async () => {
      const existente = fila({ publishedAt: null, isActive: false });
      entries.findOne.mockResolvedValueOnce(existente as never);

      await service.upsert('t1', { surface: 'home', contentKey: 'k', locale: 'es-BO', displayOrder: 1, isActive: false } as never, '7');

      expect(existente.publishedAt).toBeNull();
    });

    it('la pieza se busca por su clave COMPLETA: superficie, clave e idioma', async () => {
      await service.upsert('t1', { surface: 'home', contentKey: 'k', locale: 'en-US', displayOrder: 1, isActive: true } as never, '7');

      expect(ultima(entries.findOne).where).toEqual({
        tenantId: 't1',
        surface: 'home',
        contentKey: 'k',
        locale: 'en-US',
        deleted: false,
      });
    });

    it('los campos opcionales ausentes se guardan como nulo y no como `undefined`', async () => {
      await service.upsert('t1', { surface: 'home', contentKey: 'k', locale: 'es-BO', displayOrder: 1, isActive: true } as never, null);

      const [values] = entries.create.mock.calls.at(-1) as [Record<string, unknown>];
      for (const clave of ['title', 'subtitle', 'bodyMd', 'bulletsJson', 'metadataJson', 'actionKind', 'actionLabel', 'actionValue']) {
        expect(values[clave]).toBeNull();
      }
    });
  });

  describe('borrar', () => {
    it('una pieza que no existe es 404', async () => {
      await expect(service.remove('t1', 'c-9')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('el borrado es LÓGICO y además la apaga: lo que alguien leyó es evidencia', async () => {
      const existente = fila({ isActive: true });
      entries.findOne.mockResolvedValueOnce(existente as never);

      const resultado = await service.remove('t1', 'c-1');

      expect(existente.deleted).toBe(true);
      expect(existente.isActive).toBe(false);
      expect(existente.save).toHaveBeenCalled();
      expect(resultado).toEqual({ contentId: 'c-1', removed: true });
    });

    it('se busca dentro del tenant y entre lo no borrado', async () => {
      entries.findOne.mockResolvedValueOnce(fila() as never);

      await service.remove('t1', 'c-1');

      expect(ultima(entries.findOne).where).toEqual({ id: 'c-1', tenantId: 't1', deleted: false });
    });
  });
});
