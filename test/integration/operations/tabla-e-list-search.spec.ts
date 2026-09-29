/**
 * Tabla homogénea (E) · cola de espera y «mis conversaciones» del escritorio de soporte, cola de QR de
 * cobro por revisar e ítems de staging del catálogo, contra PostgreSQL REAL.
 *
 * Lo que un doble no demuestra: que la búsqueda por partes casa con las columnas de verdad —incluidos
 * los ids `BIGINT` convertidos a texto y los nombres que viven en OTRA tabla (comercio, sucursal)—,
 * que `%` y `_` no actúan de comodín, que el total del `findAndCountAll` es el del filtro y no el de
 * la página, y que el resumen cuenta el alcance entero aunque se filtre.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import {
  ContextCatalogModel,
  ContextStagingItemModel,
  InternalUserModel,
  PartnerBranchModel,
  PartnerProfileModel,
  PartnerQrCodeModel,
  SupportAgentProfileModel,
  SupportChannelModel,
} from '../../../src/database/models/index.js';
import { CatalogStagingReadService } from '../../../src/modules/catalog-management/application/catalog-staging-read.service.js';
import { PartnerQrReviewRepository } from '../../../src/modules/partner-onboarding/partner-qr-review.repository.js';
import { PartnerQrReviewService } from '../../../src/modules/partner-onboarding/application/partner-qr-review.service.js';
import { PartnerOnboardingRepository } from '../../../src/modules/partner-onboarding/partner-onboarding.repository.js';
import { SupportDeskListRepository } from '../../../src/modules/support/support-desk-list.repository.js';
import { buildLoanBookHarness, type LoanBookHarness } from '../credit/support/loan-book-harness.js';
import { openIntegrationDatabase, runToken, type IntegrationDatabase } from '../support/database.js';

let database: IntegrationDatabase | null = null;
let h: LoanBookHarness | null = null;
const token = runToken().toLowerCase();
const now = new Date();
// La entidad bancaria es VARCHAR(16): el sello de la corrida no cabe entero.
const corto = token.slice(-8);
const catalogIds: string[] = [];

beforeAll(async () => {
  database = await openIntegrationDatabase();
  if (database) h = await buildLoanBookHarness(database.sequelize);
});

afterAll(async () => {
  try {
    if (h) {
      const tenantId = h.tenantId;
      // Los canales de soporte son append-only: se dan de baja lógica.
      await SupportChannelModel.update({ deleted: true } as never, { where: { tenantId } });
      await PartnerQrCodeModel.destroy({ where: { tenantId } });
      await PartnerBranchModel.destroy({ where: { tenantId } });
      await PartnerProfileModel.destroy({ where: { tenantId } });
      await SupportAgentProfileModel.destroy({ where: { tenantId } });
      await InternalUserModel.destroy({ where: { tenantId } });
      if (catalogIds.length) {
        await ContextStagingItemModel.destroy({ where: { catalogId: catalogIds } });
        await ContextCatalogModel.destroy({ where: { id: catalogIds } });
      }
    }
  } finally {
    await h?.cleanup().catch(() => undefined);
    await database?.close();
  }
});

describe('Tabla homogénea (E) · soporte: cola y «mis conversaciones» (PostgreSQL real)', () => {
  it('la cola busca por código y n.º de conversación (el n.º de expediente usa la misma conversión a texto); «%» y «_» son literales; pagina con el total del filtro; el resumen es de TODA la cola', async () => {
    if (!h || !database) return;
    const tenantId = h.tenantId;
    const canal = (channelCode: string, extra: Record<string, unknown> = {}) =>
      SupportChannelModel.create({
        tenantId,
        channelCode,
        channelType: 'CHAT',
        subjectContextType: 'CONSUMER',
        status: 'QUEUED',
        requestedAt: new Date(now.getTime() + Number(extra.orden ?? 0) * 1000),
        lastActivityAt: now,
        lastMessageSequence: '0',
        claimVersion: 0,
        locale: 'es-BO',
        createdAtValue: now,
        deleted: false,
        ...extra,
      } as never);
    const a = await canal(`CH-50%-${token}`, { orden: 1 });
    await canal(`CH-50X-${token}`, { orden: 2 });
    await canal(`CH_user-${token}`, { orden: 3 });
    await canal(`CHXuser-${token}`, { orden: 4, channelType: 'ASYNC_MESSAGING' });
    await canal(`CH-ocupado-${token}`, { orden: 5, status: 'OPEN' });
    const repo = new SupportDeskListRepository(SupportChannelModel);
    const cola = (q?: string, extra: Record<string, unknown> = {}) =>
      repo.listQueuedChannels(tenantId, null, { limit: 10, offset: 0, ...(q ? { q } : {}), ...extra });

    expect((await cola('50%')).rows.map((row) => row.channelCode)).toEqual([`CH-50%-${token}`]);
    expect((await cola('ch_user')).rows.map((row) => row.channelCode)).toEqual([`CH_user-${token}`]);
    // Por n.º de conversación: el id BIGINT se busca como texto.
    expect((await cola(String(a.id))).rows.map((row) => row.channelCode)).toContain(`CH-50%-${token}`);
    // Un texto que sólo casa con un canal que YA tiene agente/está abierto no entra en la cola.
    expect((await cola(`ocupado-${token}`)).count).toBe(0);

    const delTipo = await cola(undefined, { channelType: 'ASYNC_MESSAGING' });
    expect(delTipo.rows.map((row) => row.channelCode)).toEqual([`CHXuser-${token}`]);

    const paginado = await repo.listQueuedChannels(tenantId, null, { limit: 2, offset: 2 });
    expect(paginado.count).toBe(4);
    expect(paginado.rows.map((row) => row.channelCode)).toEqual([`CH_user-${token}`, `CHXuser-${token}`]);

    // El resumen no cambia con el buscador: cuenta la cola entera (4 esperan; el abierto no).
    expect(await repo.summarizeQueued(tenantId, null)).toMatchObject({ total: 4, withoutCase: 4 });
  });

  it('«mis conversaciones» sólo trae las vivas de ESE agente, filtra por estado y busca; el resumen cuenta todas las mías', async () => {
    if (!h || !database) return;
    const tenantId = h.tenantId;
    const usuario = await InternalUserModel.create({
      tenantId,
      email: `agente.${token}@te.test`,
      fullName: 'Agente E',
      userCode: `U${randomUUID().slice(0, 8)}`,
      status: 'active',
      createdAtValue: now,
      deleted: false,
    } as never);
    const perfil = (internalUserId: string) =>
      SupportAgentProfileModel.create({
        tenantId,
        internalUserId,
        supportLevel: 'L1',
        timezone: 'America/La_Paz',
        languageCodesJson: ['es'],
        employmentStatus: 'ACTIVE',
        maxConcurrentChannels: 3,
        activeChannelCount: 0,
        presenceState: 'AVAILABLE',
        presenceChangedAt: now,
        isActive: true,
        deleted: false,
      } as never);
    const yo = await perfil(usuario.id);
    const otroUsuario = await InternalUserModel.create({
      tenantId,
      email: `otro.${token}@te.test`,
      fullName: 'Otro E',
      userCode: `U${randomUUID().slice(0, 8)}`,
      status: 'active',
      createdAtValue: now,
      deleted: false,
    } as never);
    const otro = await perfil(otroUsuario.id);
    const mio = (channelCode: string, status: string, minutos: number, agente = yo.id) =>
      SupportChannelModel.create({
        tenantId,
        channelCode,
        channelType: 'CHAT',
        subjectContextType: 'CONSUMER',
        status,
        assignedAgentProfileId: agente,
        requestedAt: now,
        lastActivityAt: new Date(now.getTime() + minutos * 60_000),
        lastMessageSequence: '0',
        claimVersion: 0,
        locale: 'es-BO',
        createdAtValue: now,
        deleted: false,
      } as never);
    await mio(`MI-1-${token}`, 'OPEN', 1);
    await mio(`MI-2-${token}`, 'WAITING_AGENT', 2);
    await mio(`MI-3-${token}`, 'WAITING_AGENT', 3);
    await mio(`MI-cerrada-${token}`, 'CLOSED', 4);
    await mio(`AJENA-${token}`, 'OPEN', 5, otro.id);
    const repo = new SupportDeskListRepository(SupportChannelModel);

    const todas = await repo.listAssignedChannels(tenantId, yo.id, { limit: 10, offset: 0 });
    expect(todas.rows.map((row) => row.channelCode)).toEqual([`MI-3-${token}`, `MI-2-${token}`, `MI-1-${token}`]);
    expect(todas.count).toBe(3);

    const esperando = await repo.listAssignedChannels(tenantId, yo.id, { limit: 1, offset: 0, status: 'WAITING_AGENT' });
    expect(esperando.count).toBe(2);
    expect(esperando.rows).toHaveLength(1);

    const buscada = await repo.listAssignedChannels(tenantId, yo.id, { limit: 10, offset: 0, q: `mi-2-${token}` });
    expect(buscada.rows.map((row) => row.channelCode)).toEqual([`MI-2-${token}`]);
    // Buscar la de otro agente, o una cerrada, no la trae.
    expect((await repo.listAssignedChannels(tenantId, yo.id, { limit: 10, offset: 0, q: 'ajena' })).count).toBe(0);
    expect((await repo.listAssignedChannels(tenantId, yo.id, { limit: 10, offset: 0, q: 'cerrada' })).count).toBe(0);

    expect(await repo.summarizeAssigned(tenantId, yo.id)).toEqual({ total: 3, waitingAgent: 2, withoutCase: 3 });
  });
});

describe('Tabla homogénea (E) · cola de QR de cobro (PostgreSQL real)', () => {
  it('q casa por columnas del QR, por comercio (nombre y NIT) y por sucursal; qrKind filtra; el total es el del filtro; el resumen, el de la cola entera', async () => {
    if (!h || !database) return;
    const tenantId = h.tenantId;
    const comercio = (legalName: string, taxId: string) =>
      PartnerProfileModel.create(
        {
          tenantId,
          legalName,
          tradeName: null,
          taxId,
          contactEmail: `c.${taxId}@te.test`,
          createdAtValue: now,
          updatedAtValue: now,
        } as never,
        { validate: false },
      );
    const sur = await comercio(`Ferretería Sur ${token} SRL`, `NIT-S-${token}`);
    const norte = await comercio(`Panadería Norte ${token} SRL`, `NIT-N-${token}`);
    const sucursal = await PartnerBranchModel.create({
      tenantId,
      partnerProfileId: norte.id,
      branchCode: `SUC-${token}`,
      name: `Sucursal Miraflores ${token}`,
      city: 'La Paz',
      status: 'active',
      createdAtValue: now,
    } as never);
    let orden = 0;
    const qr = (partnerProfileId: string, qrKind: string, extra: Record<string, unknown> = {}) =>
      PartnerQrCodeModel.create({
        tenantId,
        partnerProfileId,
        qrKind,
        storageKey: `qr/${token}/${orden}`,
        contentType: 'image/png',
        sizeBytes: 10,
        sha256: `${token}${'a'.repeat(64)}`.slice(0, 64),
        status: 'pending_review',
        createdAtValue: new Date(now.getTime() + ++orden * 1000),
        ...extra,
      } as never);
    // El índice único parcial de QR vivo pide un ámbito distinto por cada uno.
    const qrSur = await qr(sur.id, 'business');
    await qr(norte.id, 'business', { branchId: sucursal.id });
    await qr(norte.id, 'bank', { bankInstitutionCode: `BNB${corto}`, accountNumberMasked: '****50%9' });
    await qr(sur.id, 'bank', { bankInstitutionCode: 'BCP', accountNumberMasked: '****50X9' });
    await qr(sur.id, 'bank', { status: 'active', bankInstitutionCode: 'BCP2', branchId: sucursal.id });

    const cola = new PartnerQrReviewRepository(PartnerBranchModel, PartnerQrCodeModel);
    const perfiles = new PartnerOnboardingRepository(PartnerProfileModel, {} as never, PartnerBranchModel, PartnerQrCodeModel, {} as never);
    const servicio = new PartnerQrReviewService(
      {} as never,
      cola,
      {
        findManyByIds: (t: string, ids: readonly string[]) => perfiles.findProfilesByIds(t, ids),
        findIdsMatching: (t: string, q: string) => perfiles.findProfileIdsMatching(t, q),
      } as never,
      {} as never,
    );
    const pedir = (query: Record<string, unknown>) => servicio.listPendingReview(tenantId, { page: 1, limit: 10, ...query } as never);

    const porComercio = await pedir({ q: `ferretería sur ${token}` });
    expect(porComercio.items.map((item) => item.qrKind).sort()).toEqual(['bank', 'business']);
    expect(porComercio.items.every((item) => item.partnerId === String(sur.id))).toBe(true);
    // El NIT es del comercio (otra tabla), no del QR.
    expect((await pedir({ q: `nit-n-${token}` })).meta.total).toBe(2);
    // La sucursal también vive en otra tabla: sólo cuenta el QR pendiente de esa sucursal (el activo no está en la cola).
    const porSucursal = await pedir({ q: `miraflores ${token}` });
    expect(porSucursal.items).toHaveLength(1);
    expect(porSucursal.items[0]?.branch).toMatchObject({ name: `Sucursal Miraflores ${token}`, city: 'La Paz' });
    // Columnas del propio QR.
    expect((await pedir({ q: `bnb${corto}` })).meta.total).toBe(1);
    expect((await pedir({ q: String(qrSur.id) })).items.map((item) => item.qrId)).toContain(String(qrSur.id));
    // «%» y «_» son literales.
    expect((await pedir({ q: '50%' })).meta.total).toBe(1);
    expect((await pedir({ q: '****50_9' })).meta.total).toBe(0);

    const soloBanco = await pedir({ qrKind: 'bank' });
    expect(soloBanco.items.every((item) => item.qrKind === 'bank')).toBe(true);
    expect(soloBanco.meta.total).toBe(2);
    const combinado = await pedir({ qrKind: 'bank', q: `norte ${token}` });
    expect(combinado.meta.total).toBe(1);

    const pagina = await servicio.listPendingReview(tenantId, { page: 2, limit: 3 });
    expect(pagina.items).toHaveLength(1);
    expect(pagina.meta).toMatchObject({ total: 4, totalPages: 2 });
    // El resumen es de la cola entera (el activo no cuenta) y no cambia con el buscador.
    expect(pagina.summary).toMatchObject({ total: 4, business: 2, bank: 2 });
    expect(combinado.summary).toEqual(pagina.summary);
  });
});

describe('Tabla homogénea (E) · ítems de staging del catálogo (PostgreSQL real)', () => {
  it('q busca por código, nombre y n.º; aiSuggested y estado filtran; limit manda sobre pageSize; el resumen es del catálogo, no del filtro', async () => {
    if (!h || !database) return;
    const catalogo = await ContextCatalogModel.create({
      catalogCode: `bancos-${token}`,
      catalogName: 'Bancos',
      domain: 'finanzas',
      isActive: true,
      createdAtValue: now,
    } as never);
    catalogIds.push(String(catalogo.id));
    const otro = await ContextCatalogModel.create({
      catalogCode: `otro-${token}`,
      catalogName: 'Otro',
      domain: 'finanzas',
      isActive: true,
      createdAtValue: now,
    } as never);
    catalogIds.push(String(otro.id));
    const item = (catalogId: string, code: string, name: string, aiSuggested: boolean, reviewStatus = 'pending_review') =>
      ContextStagingItemModel.create({
        catalogId,
        proposedItemCode: code,
        proposedItemName: name,
        proposedAttributesJson: {},
        aiSuggested,
        reviewStatus,
        createdByType: 'user',
        createdAtValue: now,
      } as never);
    const primero = await item(catalogo.id, 'BNB', 'Banco 50% Nacional', true);
    await item(catalogo.id, 'BCP', 'Banco 50X de Crédito', false);
    await item(catalogo.id, 'BUN', 'Banco_Unión', false);
    await item(catalogo.id, 'BXUN', 'BancoXUnión', true, 'approved');
    await item(otro.id, 'AJENO', 'Banco ajeno', true);
    const servicio = new CatalogStagingReadService(ContextStagingItemModel, ContextCatalogModel);
    const base = { catalogCode: `bancos-${token}`, page: 1, pageSize: 50 };

    expect((await servicio.list({ ...base, q: '50%' })).items.map((i) => i.proposedItemCode)).toEqual(['BNB']);
    expect((await servicio.list({ ...base, q: 'banco_' })).items.map((i) => i.proposedItemCode)).toEqual(['BUN']);
    expect((await servicio.list({ ...base, q: 'bcp' })).items.map((i) => i.proposedItemCode)).toEqual(['BCP']);
    expect((await servicio.list({ ...base, q: String(primero.id) })).items.map((i) => i.proposedItemCode)).toContain('BNB');
    // El catálogo acota: «ajeno» existe, pero en otro catálogo.
    expect((await servicio.list({ ...base, q: 'ajeno' })).total).toBe(0);

    const porIa = await servicio.list({ ...base, aiSuggested: true });
    expect(porIa.items.map((i) => i.proposedItemCode).sort()).toEqual(['BNB', 'BXUN']);
    expect((await servicio.list({ ...base, aiSuggested: false })).total).toBe(2);
    expect((await servicio.list({ ...base, reviewStatus: 'approved' })).items.map((i) => i.proposedItemCode)).toEqual(['BXUN']);

    const pagina = await servicio.list({ ...base, pageSize: 50, limit: 1, page: 2, reviewStatus: 'pending_review' });
    expect(pagina.items).toHaveLength(1);
    expect(pagina.meta).toEqual({ page: 2, limit: 1, total: 3, totalPages: 3 });
    expect(pagina.pageSize).toBe(1);

    // El resumen es del catálogo entero: no cambia con el buscador ni con el estado.
    expect(pagina.summary).toEqual({ total: 4, pendingReview: 3, approved: 1, rejected: 0, aiSuggested: 2 });
    expect((await servicio.list({ ...base, q: 'bcp' })).summary).toEqual(pagina.summary);
  });
});
