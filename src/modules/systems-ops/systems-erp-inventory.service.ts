/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system incorpora al catálogo las entidades del ERP, que viven en otro repositorio y otra base.
 */
import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SystemsCatalogRepository } from './systems-catalog.repository.js';
import type { DataEntitySeed } from './systems-ops.types.js';

/**
 * Las entidades del ERP en el catálogo de metadata del portal.
 *
 * ## Por qué hace falta un camino aparte
 *
 * El catálogo se puebla escaneando los modelos Sequelize **de este repositorio**. Las 95 tablas del
 * ERP —toda la contabilidad, el CRM y la auditoría comercial— están en otro repositorio y en otra
 * base, así que ese escaneo no las ve nunca. El portal que existe para gobernar los datos de la
 * plataforma mostraba dos tercios de ella.
 *
 * El inventario llega como archivo VERSIONADO (`erp-entity-inventory.json`, que genera
 * `yarn db:metadata:export` en el ERP) y no como consulta en caliente: los dos servicios no
 * comparten base ni despliegue, y atar el refresco del catálogo a que el ERP esté arriba
 * convertiría un trabajo de metadata en algo que falla por una caída ajena. Además, que una tabla
 * nueva entre al catálogo se revisa en el diff en vez de aparecer sola.
 *
 * ## Qué se puede afirmar de estas filas y qué no
 *
 * Se marcan con `sourceSystem: 'atlas-erp'` y `confidenceLevel: 'MEDIUM'`, no `HIGH`. La razón es
 * honesta: de las propias no sólo se sabe el nombre —hay modelo, narrativa y campos—, mientras que
 * de éstas se sabe lo que el inventario trae. Igualarlas en confianza haría creer que están
 * gobernadas al mismo nivel, y no lo están todavía.
 */
interface ErpInventory {
  sourceSystem: string;
  tables: {
    schemaName: string;
    tableName: string;
    columnCount: number;
    primaryKey: string[];
    hasTenantColumn: boolean;
    comment: string | null;
  }[];
}

/** De qué habla cada schema del ERP, para clasificar sin adivinar tabla por tabla. */
const MODULE_BY_SCHEMA: Readonly<Record<string, string>> = {
  atlas_accounting: 'erp_accounting',
  atlas_sales: 'erp_sales_crm',
  atlas_audit: 'erp_audit',
};

/**
 * Toda la contabilidad toca dinero, así que el schema basta para marcarlo. En el CRM no: una
 * oportunidad comercial no es un importe, y marcar el schema entero haría que «contiene datos
 * financieros» dejara de significar nada.
 */
const FINANCIAL_TABLE = /(invoice|payment|receipt|journal|ledger|account|tax|loan|asset|budget|provision|billing|equity|bank)/i;
const PII_TABLE = /(partner|contact|user|address|person|employee)/i;

@Injectable()
export class SystemsErpInventoryService {
  private readonly logger = new Logger(SystemsErpInventoryService.name);

  constructor(private readonly catalogRepository: SystemsCatalogRepository) {}

  /** Escribe en el catálogo las entidades del ERP. Devuelve cuántas. */
  async seedErpEntities(): Promise<number> {
    const inventory = await this.readInventory();
    if (!inventory) return 0;

    for (const table of inventory.tables) {
      await this.catalogRepository.upsertDataEntity(this.toSeed(inventory.sourceSystem, table));
    }
    this.logger.log(`Catálogo: ${inventory.tables.length} entidades del ERP incorporadas.`);
    return inventory.tables.length;
  }

  private async readInventory(): Promise<ErpInventory | null> {
    const file = join(process.cwd(), 'src', 'modules', 'systems-ops', 'erp-entity-inventory.json');
    try {
      return JSON.parse(await readFile(file, 'utf8')) as ErpInventory;
    } catch (error) {
      /*
       * Sin inventario el catálogo sigue teniendo las entidades propias: se avisa y se continúa en
       * vez de tumbar el refresco entero. Perder las del ERP degrada la vista; tumbar el trabajo la
       * deja congelada, que es peor y es justo el fallo que este catálogo acaba de arreglar.
       */
      this.logger.warn(
        `No se pudo leer el inventario del ERP (${error instanceof Error ? error.message : 'desconocido'}). ` +
          'El catálogo continúa sólo con las entidades propias.',
      );
      return null;
    }
  }

  private toSeed(sourceSystem: string, table: ErpInventory['tables'][number]): DataEntitySeed {
    const containsFinancialData = table.schemaName === 'atlas_accounting' || FINANCIAL_TABLE.test(table.tableName);
    const containsPii = PII_TABLE.test(table.tableName);
    return {
      schemaName: table.schemaName,
      tableName: table.tableName,
      modelName: null,
      entityName: table.tableName
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' '),
      module: MODULE_BY_SCHEMA[table.schemaName] ?? 'erp',
      businessPurpose:
        table.comment ??
        `Entidad ${table.schemaName}.${table.tableName} del ERP, incorporada desde su inventario versionado. Debe revisarse y aprobarse en el portal.`,
      dataGrain:
        table.primaryKey.length > 0
          ? `Una fila por ${table.primaryKey.join(' + ')}.`
          : `Una fila representa un registro de ${table.tableName}.`,
      sourceSystem,
      containsPii,
      containsFinancialData,
      containsRiskData: false,
      containsLegalData: /contract|tax|compliance|legal/i.test(table.tableName),
      containsDeviceData: false,
      containsLocationData: /address|branch|territory/i.test(table.tableName),
      // Contable y auditoría son críticas por definición: sobre ellas se arma un estado financiero
      // y se responde a una revisión externa.
      isAuditCritical: table.schemaName !== 'atlas_sales' || containsFinancialData,
      detectedFrom: 'erp_inventory',
      confidenceLevel: 'MEDIUM',
      reviewStatus: 'AUTO_DETECTED',
    };
  }
}
