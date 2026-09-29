/**
 * Tabla homogénea (D) · contenido de la app, documentos de consentimiento y contratos de afiliación
 * contra PostgreSQL REAL.
 *
 * Lo que un doble no demuestra: que la búsqueda por partes casa con las columnas de verdad, que `%` y
 * `_` no actúan de comodín, que el total del `findAndCountAll` es el del filtro y no el de la página,
 * y que el resumen cuenta el catálogo entero aunque se filtre.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AppContentEntryModel, ConsentDocumentModel, PartnerContractTemplateModel } from '../../../src/database/models/index.js';
import { AppContentService } from '../../../src/modules/app-content/app-content.service.js';
import { ConsentDocumentAdminService } from '../../../src/modules/consents/consent-document-admin.service.js';
import { PartnerContractTemplateService } from '../../../src/modules/partner-onboarding/application/partner-contract-template.service.js';
import { buildLoanBookHarness, type LoanBookHarness } from '../credit/support/loan-book-harness.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
let h: LoanBookHarness | null = null;
const token = runToken().toLowerCase();

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (database) h = await buildLoanBookHarness(database.sequelize);
});

afterAll(async () => {
  try {
    if (h) {
      const tenantId = h.tenantId;
      await AppContentEntryModel.destroy({ where: { tenantId } });
      await ConsentDocumentModel.destroy({ where: { tenantId } });
      await PartnerContractTemplateModel.destroy({ where: { tenantId } });
    }
  } finally {
    await h?.cleanup().catch(() => undefined);
    await database?.close();
  }
});

const now = new Date();

describe('Tabla homogénea (D) · listados en el servidor (PostgreSQL real)', () => {
  it('contenido de la app: busca por partes, «%» y «_» son literales, filtra por visibilidad y pagina con total del filtro', async () => {
    if (!h) return;
    const tenantId = h.tenantId;
    const entry = (contentKey: string, title: string, isActive: boolean, displayOrder: number, surface = 'faq') =>
      AppContentEntryModel.create({
        tenantId,
        surface,
        contentKey,
        locale: 'es-BO',
        title,
        displayOrder,
        isActive,
        createdAtValue: now,
        deleted: false,
      } as never);
    await entry(`faq.${token}.a`, 'Cómo se calcula el 50% de mi línea', true, 1);
    await entry(`faq.${token}.b`, 'Cómo se calcula el 50X de mi línea', true, 2);
    await entry(`faq.${token}.c`, 'Qué es user_id', false, 3);
    await entry(`faq.${token}.d`, 'Qué es userXid', true, 4);
    await entry(`home.${token}.e`, 'Otra pantalla', true, 5, 'home');
    const service = new AppContentService(AppContentEntryModel);

    const porPorcentaje = await service.listForAdmin(tenantId, { surface: 'faq', q: '50%', page: 1, limit: 10 });
    expect(porPorcentaje.items.map((item) => item.contentKey)).toEqual([`faq.${token}.a`]);

    const porGuion = await service.listForAdmin(tenantId, { surface: 'faq', q: 'user_id', page: 1, limit: 10 });
    expect(porGuion.items.map((item) => item.contentKey)).toEqual([`faq.${token}.c`]);

    const porClave = await service.listForAdmin(tenantId, { surface: 'faq', q: `.${token}.`, page: 1, limit: 2 });
    expect(porClave.items).toHaveLength(2);
    expect(porClave.meta).toMatchObject({ total: 4, totalPages: 2, page: 1 });
    const pagina2 = await service.listForAdmin(tenantId, { surface: 'faq', q: `.${token}.`, page: 2, limit: 2 });
    expect(pagina2.items.map((item) => item.contentKey)).toEqual([`faq.${token}.c`, `faq.${token}.d`]);

    const ocultas = await service.listForAdmin(tenantId, { surface: 'faq', active: false, page: 1, limit: 10 });
    expect(ocultas.items.map((item) => item.contentKey)).toEqual([`faq.${token}.c`]);
    // El resumen es de la pantalla entera: no cambia con el buscador ni con el filtro.
    expect(ocultas.summary).toEqual({ total: 4, visible: 3, hidden: 1 });
    expect(porPorcentaje.summary).toEqual(ocultas.summary);
  });

  it('documentos de consentimiento: busca por código, título y resumen y filtra por estado; el resumen es del catálogo entero', async () => {
    if (!h) return;
    const tenantId = h.tenantId;
    const doc = (documentCode: string, title: string, status: string, summary: string | null = null) =>
      ConsentDocumentModel.create({
        tenantId,
        documentCode,
        versionCode: '1',
        language: 'es',
        title,
        summary,
        bodyMd: 'texto',
        status,
        effectiveFrom: '2026-01-01',
        requiresExplicitAction: true,
        createdAtValue: now,
      } as never);
    await doc(`privacidad_${token}`, 'Política de privacidad', 'published');
    await doc(`terminos_${token}`, 'Términos 100% claros', 'published', 'Lo que aceptas');
    await doc(`terminosx_${token}`, 'Términos 100X claros', 'retired');
    await doc(`borrador_${token}`, 'Borrador', 'draft');
    const service = new ConsentDocumentAdminService(ConsentDocumentModel);

    const porPorcentaje = await service.list(tenantId, { q: '100%', page: 1, limit: 10 });
    expect(porPorcentaje.items.map((item) => item.documentCode)).toEqual([`terminos_${token}`]);

    const porResumen = await service.list(tenantId, { q: 'lo que aceptas', page: 1, limit: 10 });
    expect(porResumen.items.map((item) => item.documentCode)).toEqual([`terminos_${token}`]);

    const porGuionBajo = await service.list(tenantId, { q: 'terminos_', page: 1, limit: 10 });
    expect(porGuionBajo.items.map((item) => item.documentCode)).toEqual([`terminos_${token}`]);

    const retirados = await service.list(tenantId, { status: 'retired', page: 1, limit: 10 });
    expect(retirados.items.map((item) => item.documentCode)).toEqual([`terminosx_${token}`]);
    expect(retirados.meta.total).toBe(1);
    expect(retirados.summary).toMatchObject({ published: 2, draft: 1, retired: 1, total: 4 });

    const pagina = await service.list(tenantId, { page: 2, limit: 3 });
    expect(pagina.items).toHaveLength(1);
    expect(pagina.meta).toMatchObject({ total: 4, totalPages: 2 });
  });

  it('contratos de afiliación: busca por código y nombre, «archived» es todo lo no vigente y el resumen es de todo el inquilino', async () => {
    if (!h) return;
    const tenantId = h.tenantId;
    const contrato = (templateCode: string, name: string, version: number, status: string) =>
      PartnerContractTemplateModel.create({
        tenantId,
        templateCode,
        name,
        version,
        body: 'x'.repeat(60),
        status,
        isDefault: status === 'active',
        effectiveFrom: now,
        createdAtValue: now,
        deleted: false,
      } as never);
    const codigo = `AFIL_${token}`.toUpperCase();
    await contrato(codigo, 'Contrato 20% comisión', 1, 'archived');
    await contrato(codigo, 'Contrato 20% comisión', 2, 'active');
    await contrato(`OTRO_${token}`.toUpperCase(), 'Contrato 20X comisión', 1, 'archived');
    const service = new PartnerContractTemplateService(PartnerContractTemplateModel, database!.sequelize);

    const porPorcentaje = await service.listPage(tenantId, { q: '20%', page: 1, limit: 10 });
    expect(porPorcentaje.rows.map((row) => `${row.templateCode}:${row.version}`)).toEqual([`${codigo}:2`, `${codigo}:1`]);

    const porGuionBajo = await service.listPage(tenantId, { q: 'afil_', page: 1, limit: 10 });
    expect(porGuionBajo.rows).toHaveLength(2);

    const archivadas = await service.listPage(tenantId, { status: 'archived', page: 1, limit: 1 });
    expect(archivadas.meta).toMatchObject({ total: 2, totalPages: 2 });
    expect(archivadas.rows).toHaveLength(1);
    expect(archivadas.summary).toMatchObject({ total: 3, active: 1, archived: 2 });
    // La vigente sale del resumen aunque la página filtrada sean archivadas.
    expect(archivadas.summary.current).toMatchObject({ templateCode: codigo, version: 2 });

    const vigentes = await service.listPage(tenantId, { status: 'active', page: 1, limit: 10 });
    expect(vigentes.rows.map((row) => row.version)).toEqual([2]);
  });
});
