import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { DataNotebookController } from '../../../src/modules/data-notebook/data-notebook.controller.js';
import { DATA_NOTEBOOK_LIMITS } from '../../../src/modules/data-notebook/data-notebook.constants.js';
import type { DataNotebookCatalogService } from '../../../src/modules/data-notebook/data-notebook-catalog.service.js';
import type { DataNotebookDatasetService } from '../../../src/modules/data-notebook/data-notebook-dataset.service.js';
import type { DataNotebookHistoryService } from '../../../src/modules/data-notebook/data-notebook-history.service.js';
import type { DataNotebookDocumentService } from '../../../src/modules/data-notebook/data-notebook-document.service.js';
import type { AuthenticatedUser } from '../../../src/common/types/auth.types.js';

/**
 * El cuaderno de datos.
 *
 * Tres decisiones que, mal resueltas, producen un malentendido en vez de un error.
 *
 * El catálogo publica las vistas OMITIDAS con su motivo: un catálogo que encoge en silencio se lee
 * como que la base tiene menos datos de los que tiene, y quien analiza saca conclusiones sobre un
 * universo recortado sin saberlo.
 *
 * La respuesta declara de antemano si quien mira verá el dato en CLARO o enmascarado. Es el peor
 * malentendido posible de una herramienta de análisis: creer que se comparan valores cuando se
 * comparan máscaras — dos máscaras iguales no significan dos valores iguales.
 *
 * Y las cinco operaciones sobre cuadernos toman el dueño del TOKEN, nunca de la ruta ni del cuerpo.
 * No hay un `?owner=` que alguien pueda probar a cambiar, y por eso tampoco hay una comprobación de
 * propiedad que se pueda olvidar en el endpoint siguiente: el cuaderno de otra persona simplemente
 * no aparece en la consulta.
 */
const ANALISTA = { role: 'risk_analyst', sub: 'u-1', tenantId: 't1' } as AuthenticatedUser;
const PLATAFORMA = { role: 'platform_admin', sub: 'u-2', tenantId: 't1' } as AuthenticatedUser;

describe('DataNotebookController', () => {
  let catalog: { listDatasets: jest.Mock; describe: jest.Mock };
  let datasets: { readPage: jest.Mock };
  let history: { record: jest.Mock; listOwn: jest.Mock };
  let documents: { listOwn: jest.Mock; create: jest.Mock; findOne: jest.Mock; update: jest.Mock; remove: jest.Mock };
  let controller: DataNotebookController;

  beforeEach(() => {
    catalog = {
      listDatasets: jest.fn(async () => ({ datasets: [{ code: 'loans' }], omitted: [{ code: 'sms', reason: 'SIN_COLUMNA_TENANT' }] })),
      describe: jest.fn(async () => ({
        dataset: { code: 'loans' },
        columns: [{ name: 'loan_code' }, { name: 'customer_email' }],
      })),
    };
    datasets = { readPage: jest.fn(async () => ({ rows: [], total: 0 })) };
    history = { record: jest.fn(async () => ({ id: 1 })), listOwn: jest.fn(async () => ({ items: [], total: 0 })) };
    documents = {
      listOwn: jest.fn(async () => []),
      create: jest.fn(async () => ({ id: 'nb-1' })),
      findOne: jest.fn(async () => ({ id: 'nb-1' })),
      update: jest.fn(async () => ({ id: 'nb-1' })),
      remove: jest.fn(async () => ({ deleted: true })),
    };
    controller = new DataNotebookController(
      catalog as unknown as DataNotebookCatalogService,
      datasets as unknown as DataNotebookDatasetService,
      history as unknown as DataNotebookHistoryService,
      documents as unknown as DataNotebookDocumentService,
    );
  });

  describe('catálogo', () => {
    it('las vistas OMITIDAS viajan con su motivo: un catálogo que encoge en silencio miente', async () => {
      const respuesta = await controller.listDatasets(ANALISTA);

      expect(respuesta.omitted).toEqual([{ code: 'sms', reason: 'SIN_COLUMNA_TENANT' }]);
      expect(respuesta.datasets).toEqual([{ code: 'loans' }]);
    });

    it('los techos viajan con el catálogo: la pantalla no los adivina ni los copia', async () => {
      const respuesta = await controller.listDatasets(ANALISTA);

      expect(respuesta.limits).toBe(DATA_NOTEBOOK_LIMITS);
      expect(respuesta.limits.maxPageSize).toBeGreaterThan(0);
    });

    it('la respuesta dice de antemano si se verá el dato en claro o enmascarado', async () => {
      await expect(controller.listDatasets(ANALISTA)).resolves.toHaveProperty('reveal', false);
      await expect(controller.listDatasets(PLATAFORMA)).resolves.toHaveProperty('reveal', true);
    });
  });

  describe('esquema de un dataset', () => {
    it('cada columna llega con su política de enmascarado, no sólo con su nombre', async () => {
      const respuesta = await controller.describeDataset({ code: 'loans' } as never, ANALISTA);

      expect(respuesta.dataset).toEqual({ code: 'loans' });
      expect(respuesta.columns).toHaveLength(2);
      for (const columna of respuesta.columns) {
        expect(Object.keys(columna).length).toBeGreaterThan(1);
        expect(columna).toHaveProperty('name');
      }
    });

    it('la política DEPENDE de quién pregunta: la misma columna se enmascara o no', async () => {
      const conMascara = await controller.describeDataset({ code: 'loans' } as never, ANALISTA);
      const enClaro = await controller.describeDataset({ code: 'loans' } as never, PLATAFORMA);

      expect(conMascara.columns[1]).not.toEqual(enClaro.columns[1]);
    });

    it('el código del dataset sale del parámetro de ruta', async () => {
      await controller.describeDataset({ code: 'partners' } as never, ANALISTA);

      expect(catalog.describe).toHaveBeenCalledWith('partners');
    });
  });

  describe('filas', () => {
    it('la consulta entera y el usuario llegan al servicio: el acotado por inquilino es suyo', async () => {
      await controller.readRows({ code: 'loans' } as never, { page: 2, pageSize: 50, orderDirection: 'DESC' } as never, ANALISTA);

      expect(datasets.readPage).toHaveBeenCalledWith('loans', { page: 2, pageSize: 50, orderDirection: 'DESC' }, ANALISTA);
    });
  });

  describe('historial', () => {
    it('se registra la celda ejecutada y NUNCA su resultado', async () => {
      await controller.recordHistory({ datasetCode: 'loans', cellSource: 'df.head()' } as never, ANALISTA);

      const [cuerpo] = history.record.mock.calls.at(-1) as [Record<string, unknown>];
      expect(cuerpo).toEqual({ datasetCode: 'loans', cellSource: 'df.head()' });
      expect(cuerpo).not.toHaveProperty('result');
    });

    it('el historial que se lee es el PROPIO: el dueño sale del token', async () => {
      await controller.listHistory({ limit: 20, offset: 40 } as never, ANALISTA);

      expect(history.listOwn).toHaveBeenCalledWith(ANALISTA, 20, 40);
    });
  });

  describe('cuadernos guardados', () => {
    it('las cinco operaciones toman el dueño del TOKEN, no de la ruta ni del cuerpo', async () => {
      await controller.listNotebooks(ANALISTA);
      await controller.createNotebook({ title: 'mío', ownerId: 'u-ajeno' } as never, ANALISTA);
      await controller.readNotebook({ id: 'nb-1' } as never, ANALISTA);
      await controller.updateNotebook({ id: 'nb-1' } as never, { title: 'otro' } as never, ANALISTA);
      await controller.deleteNotebook({ id: 'nb-1' } as never, ANALISTA);

      expect(documents.listOwn).toHaveBeenCalledWith(ANALISTA);
      expect(documents.create).toHaveBeenCalledWith({ title: 'mío', ownerId: 'u-ajeno' }, ANALISTA);
      expect(documents.findOne).toHaveBeenCalledWith('nb-1', ANALISTA);
      expect(documents.update).toHaveBeenCalledWith('nb-1', { title: 'otro' }, ANALISTA);
      expect(documents.remove).toHaveBeenCalledWith('nb-1', ANALISTA);
    });

    it('no hay ningún parámetro de dueño que alguien pueda probar a cambiar', async () => {
      await controller.listNotebooks(ANALISTA);

      expect(documents.listOwn.mock.calls[0]).toHaveLength(1);
    });

    it('cada operación va a su propio método: borrar no puede caer en actualizar', async () => {
      await controller.deleteNotebook({ id: 'nb-1' } as never, ANALISTA);

      expect(documents.remove).toHaveBeenCalledTimes(1);
      expect(documents.update).not.toHaveBeenCalled();
    });
  });
});
