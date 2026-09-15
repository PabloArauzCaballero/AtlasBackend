import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DataNotebookCatalogService } from '../../../src/modules/data-notebook/data-notebook-catalog.service.js';
import { NOTEBOOK_SCHEMA } from '../../../src/modules/data-notebook/data-notebook.constants.js';
import type { ReadQueryService } from '../../../src/common/database/read-query.service.js';

/**
 * Qué datasets existen y qué forma tiene cada uno.
 *
 * La línea que sostiene todo el módulo está aquí: el alcance NO se deduce.
 *
 * Una vista descubierta en la base se sirve si publica columna de inquilino, y va acotada por ella.
 * Si no la publica, NO se sirve por descubrimiento: hace falta que alguien la haya declarado
 * `PLATFORM` en el catálogo, que es una firma. Deducir «sin columna de inquilino = de plataforma»
 * convertiría cualquier migración que quite `tenant_id` en una fuga entre organizaciones, en
 * silencio y con el catálogo en verde.
 *
 * Por el mismo motivo, un dataset DECLARADO por inquilino cuya vista no publique por dónde acotarlo
 * no se sirve: un cuaderno con una vista menos es un defecto visible, y una fuga entre inquilinos
 * no lo es hasta que alguien la encuentra.
 *
 * La forma se descubre contra `information_schema` y no se declara a mano: una lista escrita en el
 * código es correcta el día que se escribe y deja de serlo en la primera migración que añada una
 * columna, sin que nada lo avise — y esa columna nueva, que nadie clasificó, viajaría sin política
 * de enmascarado.
 *
 * Y el orden pedido se traduce a una columna REAL: es lo que permite interpolarlo en el `ORDER BY`
 * —un identificador no admite parámetro en Postgres— haciendo que el único texto interpolado en
 * toda la consulta venga del catálogo del servidor y nunca del cuerpo de la petición.
 */
describe('DataNotebookCatalogService', () => {
  let select: jest.Mock;
  let service: DataNotebookCatalogService;

  beforeEach(() => {
    select = jest.fn(async () => []);
    service = new DataNotebookCatalogService({ select } as unknown as ReadQueryService);
  });

  /** Responde la lista de vistas a la primera consulta y las columnas a las siguientes. */
  function conVistas(vistas: Array<{ table_name: string; has_tenant: boolean | null }>, columnas: string[] = []) {
    select.mockImplementation((async (sql: unknown) => {
      if (String(sql).includes('information_schema.views')) return vistas;
      return columnas.map((nombre) => ({ column_name: nombre, data_type: 'text' }));
    }) as never);
  }

  describe('el catálogo se descubre', () => {
    it('una vista DECLARADA se sirve con su ficha escrita, no con la deducida', async () => {
      conVistas([{ table_name: 'v_customer_overview_v1', has_tenant: true }]);

      const { datasets } = await service.listDatasets();

      expect(datasets).toHaveLength(1);
      expect(datasets[0]).toMatchObject({ code: 'customer-overview', label: 'Panorama de clientes', scope: 'TENANT' });
    });

    it('una vista NUEVA con columna de inquilino se sirve sin tocar el código', async () => {
      conVistas([{ table_name: 'v_partner_settlement_v1', has_tenant: true }]);

      const { datasets, omitted } = await service.listDatasets();

      expect(datasets[0]).toMatchObject({ code: 'partner-settlement', view: 'v_partner_settlement_v1', scope: 'TENANT' });
      expect(omitted).toEqual([]);
    });

    it('el sufijo de versión se cae del código: arrastrarlo rompería los cuadernos guardados al salir `_v2`', async () => {
      conVistas([{ table_name: 'v_partner_settlement_v3', has_tenant: true }]);

      const { datasets } = await service.listDatasets();

      expect(datasets[0].code).toBe('partner-settlement');
      expect(datasets[0].view).toBe('v_partner_settlement_v3');
    });

    it('el rótulo por omisión es legible, no el nombre de la vista', async () => {
      conVistas([{ table_name: 'v_partner_settlement_v1', has_tenant: true }]);

      const { datasets } = await service.listDatasets();

      expect(datasets[0].label).toBe('Partner settlement');
    });

    it('una vista SIN columna de inquilino NO se sirve por descubrimiento: el alcance no se deduce', async () => {
      conVistas([{ table_name: 'v_algo_global_v1', has_tenant: false }]);

      const { datasets, omitted } = await service.listDatasets();

      expect(datasets).toEqual([]);
      expect(omitted).toHaveLength(1);
      expect(omitted[0].view).toBe('v_algo_global_v1');
      expect(omitted[0].reason).toContain('declararla de plataforma');
    });

    it('`has_tenant` nulo cuenta como que no la publica: ante la duda, no se sirve', async () => {
      conVistas([{ table_name: 'v_algo_v1', has_tenant: null }]);

      const { datasets, omitted } = await service.listDatasets();

      expect(datasets).toEqual([]);
      expect(omitted).toHaveLength(1);
    });

    it('una DECLARADA de plataforma sí se sirve aunque no tenga columna de inquilino: hay una firma detrás', async () => {
      conVistas([{ table_name: 'v_provider_health_latest_v1', has_tenant: false }]);

      const { datasets, omitted } = await service.listDatasets();

      expect(datasets[0]).toMatchObject({ code: 'provider-health-latest', scope: 'PLATFORM' });
      expect(omitted).toEqual([]);
    });

    it('la consulta se acota al esquema del cuaderno y pasa las columnas de inquilino por parámetro', async () => {
      await service.listDatasets();

      const [sql, params] = select.mock.calls[0] as [string, Record<string, unknown>];
      expect(sql).toContain('information_schema.views');
      expect(params).toMatchObject({ schema: NOTEBOOK_SCHEMA });
      expect(params.tenantColumns).toEqual(['tenant_id', '_tenant_id']);
    });
  });

  describe('buscar un dataset', () => {
    it('uno que no está en el catálogo es 404 con su código dentro', async () => {
      conVistas([]);

      await expect(service.findDataset('inventado')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.findDataset('inventado')).rejects.toThrow('inventado');
    });

    it('una vista descartada tampoco se puede pedir por su código', async () => {
      conVistas([{ table_name: 'v_algo_global_v1', has_tenant: false }]);

      await expect(service.findDataset('algo-global')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('la forma de un dataset', () => {
    it('sale de `information_schema`, en el orden en que la vista declara sus columnas', async () => {
      conVistas([{ table_name: 'v_customer_overview_v1', has_tenant: true }], ['tenant_id', 'customer_id', 'email']);

      const forma = await service.describe('customer-overview');

      expect(forma.columns.map((c) => c.name)).toEqual(['tenant_id', 'customer_id', 'email']);
      expect(forma.tenantColumn).toBe('tenant_id');
    });

    it('la vista que está en el catálogo y no en la base manda a mirar el DESPLIEGUE, no los datos', async () => {
      conVistas([{ table_name: 'v_customer_overview_v1', has_tenant: true }], []);

      const fallo = await service.describe('customer-overview').catch((error: unknown) => error);

      expect(fallo).toBeInstanceOf(ServiceUnavailableException);
      expect((fallo as ServiceUnavailableException).message).toContain('db:migration:up');
    });

    it('un dataset declarado por inquilino cuya vista perdió la columna NO se sirve', async () => {
      conVistas([{ table_name: 'v_customer_overview_v1', has_tenant: true }], ['customer_id', 'email']);

      const fallo = await service.describe('customer-overview').catch((error: unknown) => error);

      expect(fallo).toBeInstanceOf(ServiceUnavailableException);
      expect((fallo as ServiceUnavailableException).message).toContain('por escrito');
    });

    it('uno de PLATAFORMA ignora la columna aunque exista: decide la declaración, no la vista de ese día', async () => {
      conVistas([{ table_name: 'v_provider_health_latest_v1', has_tenant: false }], ['tenant_id', 'provider_code']);

      const forma = await service.describe('provider-health-latest');

      expect(forma.tenantColumn).toBeNull();
      expect(forma.dataset.scope).toBe('PLATFORM');
    });

    it('`_tenant_id` sirve igual que `tenant_id`: son las dos convenciones del repositorio', async () => {
      conVistas([{ table_name: 'v_customer_overview_v1', has_tenant: true }], ['_tenant_id', 'customer_id']);

      const forma = await service.describe('customer-overview');

      expect(forma.tenantColumn).toBe('_tenant_id');
    });

    it('la forma se cachea por proceso: cambia con una migración, no entre peticiones', async () => {
      conVistas([{ table_name: 'v_customer_overview_v1', has_tenant: true }], ['tenant_id', 'customer_id']);

      await service.describe('customer-overview');
      const llamadas = select.mock.calls.length;
      await service.describe('customer-overview');

      expect(select.mock.calls.length).toBe(llamadas);
    });
  });

  describe('la columna de orden', () => {
    const forma = {
      dataset: { code: 'x', view: 'v', label: 'x', description: 'x', scope: 'TENANT' as const },
      columns: [
        { name: 'customer_id', dataType: 'text' },
        { name: 'created_at', dataType: 'timestamp' },
      ],
      tenantColumn: 'tenant_id',
    };

    it('devuelve el nombre verificado contra el catálogo del servidor', () => {
      expect(service.resolveOrderColumn(forma, 'created_at')).toBe('created_at');
    });

    it('una columna que no existe se descarta: es lo único interpolado en la consulta', () => {
      expect(service.resolveOrderColumn(forma, 'created_at; DROP TABLE x')).toBeNull();
      expect(service.resolveOrderColumn(forma, 'inventada')).toBeNull();
    });

    it('sin orden pedido no se ordena, y no se inventa una columna', () => {
      expect(service.resolveOrderColumn(forma, undefined)).toBeNull();
      expect(service.resolveOrderColumn(forma, '')).toBeNull();
    });
  });
});
