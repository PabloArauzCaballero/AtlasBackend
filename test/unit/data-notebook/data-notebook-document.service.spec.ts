import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { DataNotebookDocumentService } from '../../../src/modules/data-notebook/data-notebook-document.service.js';
import { DATA_NOTEBOOK_LIMITS } from '../../../src/modules/data-notebook/data-notebook.constants.js';
import type { DataNotebookDocumentModel } from '../../../src/database/models/index.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';

/**
 * Los cuadernos guardados de cada persona.
 *
 * Todo se acota por `(tenant, dueño)` y esa pareja se toma SIEMPRE del token, nunca del cuerpo ni
 * de la ruta. Es lo que hace que «abrir el cuaderno 7» no pueda devolver el cuaderno 7 de otra
 * organización: la consulta no tiene forma de encontrarlo, así que no hay una comprobación de
 * propiedad que alguien pueda olvidarse de escribir en el endpoint siguiente. Por eso se prueba en
 * las CINCO operaciones.
 *
 * El listado NO devuelve las celdas: con cuadernos largos serían megabytes para pintar una lista de
 * títulos, y `cellCount` es lo único que hace falta para elegir cuál abrir.
 *
 * El tope se mide sobre el JSON REAL que va a la fila y no sobre el número de celdas: desde que el
 * cuaderno guarda también lo que cada celda arrojó, una tabla de veinte mil filas o cuatro gráficos
 * pesan más que doscientas celdas de código. Y el mensaje dice el tamaño Y el techo porque lo que
 * hay que hacer después difiere según por cuánto se pasó.
 *
 * Borrar algo que no existe NO es un error del cliente: puede ser el segundo clic de alguien
 * impaciente, o el mismo cuaderno borrado en otra pestaña. Se responde con el hecho.
 *
 * Y al salir NO se valida la forma de las celdas: el contrato se aplica al ENTRAR, que es donde
 * puede rechazarse algo. Negarse a devolver un cuaderno viejo por una celda con un campo de más
 * sería perderle el trabajo a su dueño.
 */
const USUARIO = { sub: 'u-1', tenantId: 't1', role: 'risk_analyst' } as AuthenticatedUser;

function fila(overrides: Record<string, unknown> = {}) {
  return {
    id: 'nb-1',
    title: 'Mora por comercio',
    datasetCode: 'loans',
    cells: [{ kind: 'code', source: 'df.head()' }],
    createdAt: new Date('2026-09-01T10:00:00Z'),
    updatedAt: new Date('2026-09-02T10:00:00Z'),
    save: jest.fn(async () => undefined),
    ...overrides,
  } as unknown as DataNotebookDocumentModel;
}

const CUERPO = { title: 'Mora por comercio', datasetCode: 'loans', cells: [{ kind: 'code', source: 'df.head()' }] } as never;

describe('DataNotebookDocumentService', () => {
  let model: { findAll: jest.Mock; findOne: jest.Mock; create: jest.Mock; count: jest.Mock; destroy: jest.Mock };
  let service: DataNotebookDocumentService;

  beforeEach(() => {
    model = {
      findAll: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
      create: jest.fn(async (values: unknown) => fila(values as Record<string, unknown>)),
      count: jest.fn(async () => 0),
      destroy: jest.fn(async () => 1),
    };
    service = new DataNotebookDocumentService(model as unknown as typeof DataNotebookDocumentModel);
  });

  function ultima(mock: jest.Mock): { where: Record<string, unknown>; order?: unknown[]; limit?: number } {
    return mock.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> };
  }

  describe('el dueño sale del token', () => {
    it('las cinco operaciones acotan por (tenant, dueño)', async () => {
      await service.listOwn(USUARIO);
      expect(ultima(model.findAll).where).toEqual({ tenantId: 't1', ownerUserId: 'u-1' });

      await service.create(CUERPO, USUARIO);
      expect(model.create.mock.calls.at(-1)?.[0]).toMatchObject({ tenantId: 't1', ownerUserId: 'u-1' });

      model.findOne.mockResolvedValueOnce(fila() as never);
      await service.findOne('nb-1', USUARIO);
      expect(ultima(model.findOne).where).toEqual({ tenantId: 't1', ownerUserId: 'u-1', id: 'nb-1' });

      model.findOne.mockResolvedValueOnce(fila() as never);
      await service.update('nb-1', CUERPO, USUARIO);
      expect(ultima(model.findOne).where).toEqual({ tenantId: 't1', ownerUserId: 'u-1', id: 'nb-1' });

      await service.remove('nb-1', USUARIO);
      expect(ultima(model.destroy).where).toEqual({ tenantId: 't1', ownerUserId: 'u-1', id: 'nb-1' });
    });

    it('un token sin tenant acota con nulo y no lo omite: omitirlo abriría los de todos', async () => {
      await service.listOwn({ sub: 'u-1', role: 'risk_analyst' } as AuthenticatedUser);

      expect(ultima(model.findAll).where).toEqual({ tenantId: null, ownerUserId: 'u-1' });
    });

    it('el cuaderno de otra persona no existe para esta: 404, no 403', async () => {
      model.findOne.mockResolvedValue(null as never);

      await expect(service.findOne('nb-ajeno', USUARIO)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.update('nb-ajeno', CUERPO, USUARIO)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listado', () => {
    it('NO devuelve las celdas: sólo cuántas hay, que es lo que hace falta para elegir', async () => {
      model.findAll.mockResolvedValueOnce([fila({ cells: [{ kind: 'code' }, { kind: 'md' }] })] as never);

      const [resumen] = await service.listOwn(USUARIO);

      expect(resumen).not.toHaveProperty('cells');
      expect(resumen.cellCount).toBe(2);
      expect(resumen.updatedAt).toBe('2026-09-02T10:00:00.000Z');
    });

    it('un cuaderno con celdas ilegibles cuenta cero en vez de romper la lista', async () => {
      model.findAll.mockResolvedValueOnce([fila({ cells: null }), fila({ cells: 'roto' })] as never);

      const resumen = await service.listOwn(USUARIO);

      expect(resumen.map((r) => r.cellCount)).toEqual([0, 0]);
    });

    it('sale lo modificado más recientemente primero, con el tope por persona', async () => {
      await service.listOwn(USUARIO);

      expect(ultima(model.findAll).order).toEqual([['updated_at', 'DESC']]);
      expect(ultima(model.findAll).limit).toBe(DATA_NOTEBOOK_LIMITS.maxNotebooksPerUser);
    });
  });

  describe('crear', () => {
    it('sella las dos fechas y guarda el dataset como nulo cuando no llega', async () => {
      const dto = await service.create({ title: 'Suelto', cells: [] } as never, USUARIO);

      const [values] = model.create.mock.calls.at(-1) as [Record<string, unknown>];
      expect(values.datasetCode).toBeNull();
      expect(values.createdAt).toBeInstanceOf(Date);
      expect(values.updatedAt).toBe(values.createdAt);
      expect(dto).toHaveProperty('id');
    });

    it('el tope por persona se dice CON el número: «has llegado al tope» obliga a adivinar cuántos borrar', async () => {
      model.count.mockResolvedValueOnce(DATA_NOTEBOOK_LIMITS.maxNotebooksPerUser as never);

      const fallo = await service.create(CUERPO, USUARIO).catch((error: unknown) => error);

      expect(fallo).toBeInstanceOf(ForbiddenException);
      expect((fallo as ForbiddenException).message).toContain(String(DATA_NOTEBOOK_LIMITS.maxNotebooksPerUser));
      expect(model.create).not.toHaveBeenCalled();
    });

    it('el tope se comprueba ANTES de contar: un cuaderno enorme no gasta una consulta', async () => {
      const enorme = { title: 'x', cells: [{ kind: 'output', data: 'y'.repeat(DATA_NOTEBOOK_LIMITS.maxNotebookBytes + 1) }] } as never;

      await expect(service.create(enorme, USUARIO)).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(model.count).not.toHaveBeenCalled();
    });
  });

  describe('el tope de tamaño', () => {
    it('se mide sobre el JSON REAL, no sobre el número de celdas', async () => {
      const pocasPeroPesadas = {
        title: 'x',
        cells: [{ kind: 'output', data: 'y'.repeat(DATA_NOTEBOOK_LIMITS.maxNotebookBytes) }],
      } as never;
      await expect(service.create(pocasPeroPesadas, USUARIO)).rejects.toBeInstanceOf(PayloadTooLargeException);

      const muchasPeroLigeras = { title: 'x', cells: Array.from({ length: 300 }, () => ({ kind: 'code', source: 'df.head()' })) } as never;
      await expect(service.create(muchasPeroLigeras, USUARIO)).resolves.toBeDefined();
    });

    it('el mensaje dice el tamaño Y el techo: qué hacer después depende de por cuánto se pasó', async () => {
      const enorme = { title: 'x', cells: [{ kind: 'output', data: 'y'.repeat(DATA_NOTEBOOK_LIMITS.maxNotebookBytes * 2) }] } as never;

      const fallo = await service.create(enorme, USUARIO).catch((error: unknown) => error);

      expect((fallo as PayloadTooLargeException).message).toMatch(/\d+\.\d MB.*\d+\.\d MB/);
      expect((fallo as PayloadTooLargeException).message).toContain('menos filas');
    });

    it('también se comprueba al ACTUALIZAR, no sólo al crear', async () => {
      model.findOne.mockResolvedValue(fila() as never);
      const enorme = { title: 'x', cells: [{ kind: 'output', data: 'y'.repeat(DATA_NOTEBOOK_LIMITS.maxNotebookBytes + 1) }] } as never;

      await expect(service.update('nb-1', enorme, USUARIO)).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(model.findOne).not.toHaveBeenCalled();
    });
  });

  describe('actualizar', () => {
    it('reescribe título, dataset y celdas, y sella la fecha de modificación', async () => {
      const existente = fila();
      model.findOne.mockResolvedValueOnce(existente as never);

      await service.update('nb-1', { title: 'Otro', datasetCode: null, cells: [{ kind: 'md' }] } as never, USUARIO);

      expect(existente.title).toBe('Otro');
      expect(existente.datasetCode).toBeNull();
      expect(existente.updatedAt).toBeInstanceOf(Date);
      expect(existente.save).toHaveBeenCalled();
    });

    it('NO reescribe la fecha de creación: es cuándo nació, no cuándo se guardó', async () => {
      const nacimiento = new Date('2026-01-01T00:00:00Z');
      const existente = fila({ createdAt: nacimiento });
      model.findOne.mockResolvedValueOnce(existente as never);

      const dto = await service.update('nb-1', CUERPO, USUARIO);

      expect(dto.createdAt).toBe(nacimiento.toISOString());
    });
  });

  describe('borrar', () => {
    it('borrar algo que no existe NO es un error: se responde con el hecho', async () => {
      model.destroy.mockResolvedValueOnce(0 as never);

      await expect(service.remove('nb-9', USUARIO)).resolves.toEqual({ deleted: false });
    });

    it('borrar lo propio lo declara borrado', async () => {
      await expect(service.remove('nb-1', USUARIO)).resolves.toEqual({ deleted: true });
    });
  });

  describe('al devolver un cuaderno', () => {
    it('unas celdas ilegibles salen como lista vacía en vez de negarle el cuaderno a su dueño', async () => {
      model.findOne.mockResolvedValueOnce(fila({ cells: { roto: true } }) as never);

      const dto = await service.findOne('nb-1', USUARIO);

      expect(dto.cells).toEqual([]);
      expect(dto.title).toBe('Mora por comercio');
    });

    it('una celda con un campo de más se devuelve tal cual: el contrato se aplica al ENTRAR', async () => {
      model.findOne.mockResolvedValueOnce(fila({ cells: [{ kind: 'code', source: 'x', campoDeVersionVieja: 1 }] }) as never);

      const dto = await service.findOne('nb-1', USUARIO);

      expect(dto.cells[0]).toMatchObject({ campoDeVersionVieja: 1 });
    });

    it('el identificador viaja como texto y las fechas en ISO', async () => {
      model.findOne.mockResolvedValueOnce(fila({ id: 77 }) as never);

      const dto = await service.findOne('77', USUARIO);

      expect(dto.id).toBe('77');
      expect(dto.createdAt).toBe('2026-09-01T10:00:00.000Z');
    });
  });
});
