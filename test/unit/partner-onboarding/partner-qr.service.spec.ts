import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PartnerQrService } from '../../../src/modules/partner-onboarding/application/partner-qr.service.js';
import { PartnerQrReviewService } from '../../../src/modules/partner-onboarding/application/partner-qr-review.service.js';
import { qrPng } from '../../../scripts/fixtures/qr-imagen.js';

/**
 * El QR de cobro lo revisa una persona antes de que lo vea un cliente.
 *
 * Hasta el 2026-09-14 no existía `review`: todo QR nacía en `pending_review` y nadie lo sacaba de
 * ahí, y `findLivePaymentQr` servía igualmente ese QR sin revisar a la app del cliente. Aquí se fija
 * lo contrario: sólo `active` llega al cliente; aprobar archiva el activo anterior; rechazar exige
 * nota; y registrar un QR nuevo NO retira el activo vigente, porque eso dejaba al comercio sin QR
 * de cobro durante toda la revisión.
 */
type Qr = {
  id: string;
  qrKind: string;
  branchId: string | null;
  status: string;
  storageKey: string;
  contentType: string;
  bankInstitutionCode: string | null;
  accountNumberMasked: string | null;
  sha256: string;
  update?: jest.Mock;
};

function qr(partial: Partial<Qr>): Qr {
  return {
    id: '1',
    qrKind: 'bank',
    branchId: null,
    status: 'pending_review',
    storageKey: '1/partner-7/qr-bank/x.png',
    contentType: 'image/png',
    bankInstitutionCode: 'BNB',
    accountNumberMasked: '****1234',
    sha256: 'a'.repeat(64),
    ...partial,
  };
}

const PNG = qrPng();
const TX = { id: 'tx' };

function construir(opciones: { live?: Qr | null; active?: Qr | null; porId?: Qr | null } = {}) {
  const network = {
    findLiveQr: jest.fn(async (..._args: unknown[]) => opciones.live ?? null),
    findActiveQr: jest.fn(async (..._args: unknown[]) => opciones.active ?? null),
    findQrById: jest.fn(async (..._args: unknown[]) => opciones.porId ?? null),
    createQrCode: jest.fn(async (values: Record<string, unknown>, ..._rest: unknown[]) => ({
      ...values,
      id: '99',
      status: 'pending_review',
    })),
    markQrReplaced: jest.fn(async (viejo: Qr, nuevoId: string) => ({ ...viejo, status: 'replaced', replacedById: nuevoId })),
    inTransaction: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(TX)),
    archiveLiveQrs: jest.fn(async (..._args: unknown[]) => (opciones.live ? 1 : 0)),
    markQrReviewed: jest.fn(async (target: Qr, review: Record<string, unknown>) => ({ ...target, ...review, verifiedAt: new Date() })),
    markQrActive: jest.fn(async (target: Qr, note: string, ..._rest: unknown[]) => ({
      ...target,
      status: 'active',
      reviewNote: note,
      verifiedAt: new Date(),
    })),
    findBranchById: jest.fn(async () => null),
    listQrCodes: jest.fn(async () => []),
    findPosById: jest.fn(async () => ({ id: '9', status: 'active', partnerProfileId: '7', branchId: '3' })),
  };
  const cola = {
    listQrCodesPendingReview: jest.fn(async (..._args: unknown[]) => ({ rows: [] as unknown[], count: 0 })),
    summarizeQrPendingReview: jest.fn(async () => ({ total: 23, business: 20, bank: 3, oldestCreatedAt: null })),
    findBranchIdsMatching: jest.fn(async (..._args: unknown[]) => [] as string[]),
    findBranchesByIds: jest.fn(async (..._args: unknown[]) => [] as unknown[]),
  };
  const profiles = {
    requireProfile: jest.fn(async () => ({ id: '7', onboardingStatus: 'approved' })),
    findManyByIds: jest.fn(async (..._args: unknown[]) => [
      { id: '7', legalName: 'Ferretería Sur SRL', tradeName: 'Ferretería Sur', taxId: '1023456029', onboardingStatus: 'approved' },
    ]),
    findIdsMatching: jest.fn(async (..._args: unknown[]) => [] as string[]),
  };
  const storage = {
    isConfigured: () => true,
    readObjectMetadata: jest.fn(async () => ({ contentType: 'image/png', sizeBytes: PNG.byteLength, sha256Hex: 'b'.repeat(64) })),
    readObject: jest.fn(async () => PNG),
  };
  const metrics = { recordPartnerOnboardingStep: jest.fn() };
  const hooks = { alRegistrarArchivoDelComercio: jest.fn(async (..._args: unknown[]) => undefined) };
  const notice = { avisarCambioDeQrDeCobro: jest.fn(async (..._args: unknown[]) => undefined) };
  const audit = { recordQrChange: jest.fn(async (..._args: unknown[]) => ({})) };
  const service = new PartnerQrService(
    network as never,
    profiles as never,
    storage as never,
    metrics as never,
    hooks as never,
    notice as never,
    audit as never,
  );
  const revision = new PartnerQrReviewService(network as never, cola as never, profiles as never, metrics as never);
  return { service, revision, network, cola, profiles, storage, metrics, hooks, notice, audit };
}

describe('PartnerQrReviewService · cola de QR pendientes', () => {
  it('pagina en el servidor y resuelve los comercios en UNA consulta, no uno a uno en serie', async () => {
    const { revision, cola, profiles } = construir();
    cola.listQrCodesPendingReview.mockResolvedValueOnce({
      rows: [
        qr({ id: '5', partnerProfileId: '7', createdAtValue: new Date() } as unknown as Partial<Qr>),
        qr({ id: '6', partnerProfileId: '7', createdAtValue: new Date() } as unknown as Partial<Qr>),
        qr({ id: '8', partnerProfileId: '404', createdAtValue: new Date() } as unknown as Partial<Qr>),
      ],
      count: 23,
    } as never);

    const pagina = await revision.listPendingReview('t1', { page: 3, limit: 10 });

    expect(cola.listQrCodesPendingReview).toHaveBeenCalledWith('t1', { limit: 10, offset: 20, qrKind: undefined, search: undefined });
    expect(profiles.findManyByIds).toHaveBeenCalledTimes(1);
    expect(profiles.requireProfile).not.toHaveBeenCalled();
    expect(pagina.meta).toEqual({ page: 3, limit: 10, total: 23, totalPages: 3 });
    expect(pagina.items[0]?.partner).toEqual({
      legalName: 'Ferretería Sur SRL',
      tradeName: 'Ferretería Sur',
      taxId: '1023456029',
      onboardingStatus: 'approved',
    });
    expect(pagina.summary).toEqual({ total: 23, business: 20, bank: 3, oldestCreatedAt: null });
    // Un comercio que ya no existe no se inventa: `partner` es null.
    expect(pagina.items[2]?.partner).toBeNull();
  });
});

describe('PartnerQrReviewService · buscador y filtro de la cola', () => {
  it('q resuelve los comercios y las sucursales que casan y los pasa junto al texto; qrKind viaja tal cual', async () => {
    const { revision, cola, profiles } = construir();
    profiles.findIdsMatching.mockResolvedValueOnce(['7']);
    cola.findBranchIdsMatching.mockResolvedValueOnce(['3', '4']);

    await revision.listPendingReview('t1', { page: 1, limit: 10, q: '  sur ', qrKind: 'bank' });

    expect(profiles.findIdsMatching).toHaveBeenCalledWith('t1', 'sur');
    expect(cola.findBranchIdsMatching).toHaveBeenCalledWith('t1', 'sur');
    expect(cola.listQrCodesPendingReview).toHaveBeenCalledWith('t1', {
      limit: 10,
      offset: 0,
      qrKind: 'bank',
      search: { q: 'sur', partnerIds: ['7'], branchIds: ['3', '4'] },
    });
  });

  it('sin q no se consultan comercios ni sucursales para buscar', async () => {
    const { revision, profiles, cola } = construir();
    await revision.listPendingReview('t1', { page: 1, limit: 10 });
    expect(profiles.findIdsMatching).not.toHaveBeenCalled();
    expect(cola.findBranchIdsMatching).not.toHaveBeenCalled();
  });

  it('cada QR trae su sucursal, o null si es del comercio entero', async () => {
    const { revision, cola } = construir();
    cola.listQrCodesPendingReview.mockResolvedValueOnce({
      rows: [
        qr({ id: '5', partnerProfileId: '7', branchId: '3', createdAtValue: new Date() } as unknown as Partial<Qr>),
        qr({ id: '6', partnerProfileId: '7', branchId: null, createdAtValue: new Date() } as unknown as Partial<Qr>),
      ],
      count: 2,
    } as never);
    cola.findBranchesByIds.mockResolvedValueOnce([{ id: '3', branchCode: 'SUC-01', name: 'Sucursal Centro', city: null }] as never);

    const pagina = await revision.listPendingReview('t1', { page: 1, limit: 10 });

    expect(pagina.items[0]?.branch).toEqual({ branchCode: 'SUC-01', name: 'Sucursal Centro', city: null });
    expect(pagina.items[1]?.branch).toBeNull();
  });
});

describe('PartnerQrReviewService · revisión', () => {
  let ahora: number;
  beforeEach(() => {
    ahora = Date.now();
  });

  it('aprobar activa el QR y archiva como `replaced` el que estaba activo en el mismo ámbito', async () => {
    const pendiente = qr({ id: '5' });
    const activo = qr({ id: '3', status: 'active' });
    const { revision, network } = construir({ porId: pendiente, active: activo });

    const revisado = await revision.review('1', '7', '5', { approved: true, internalUserId: '42' });

    expect(revisado.status).toBe('active');
    expect(network.markQrReplaced).toHaveBeenCalledWith(activo, '5');
    const [, review] = network.markQrReviewed.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(review.status).toBe('active');
    expect(review.reviewedByInternalUserId).toBe('42');
    expect((revisado as { verifiedAt: Date }).verifiedAt.getTime()).toBeGreaterThanOrEqual(ahora);
  });

  it('aprobar sin activo previo no archiva nada', async () => {
    const { revision, network } = construir({ porId: qr({ id: '5' }), active: null });
    await revision.review('1', '7', '5', { approved: true, internalUserId: null });
    expect(network.markQrReplaced).not.toHaveBeenCalled();
  });

  it('rechazar guarda la nota: es lo único que le dice al comercio qué corregir', async () => {
    const { revision, network } = construir({ porId: qr({ id: '5' }) });

    const revisado = await revision.review('1', '7', '5', { approved: false, note: 'La imagen no es del banco', internalUserId: '42' });

    expect(revisado.status).toBe('rejected');
    const [, review] = network.markQrReviewed.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(review.reviewNote).toBe('La imagen no es del banco');
    expect(network.markQrReplaced).not.toHaveBeenCalled();
  });

  it('un QR activo se puede REVOCAR con nota (es la única puerta que queda desde el 2026-10-02), pero no «re-aprobar»', async () => {
    const activo = qr({ id: '3', status: 'active' });
    const { revision, network } = construir({ porId: activo });

    const revocado = await revision.review('1', '7', '3', { approved: false, note: 'La cuenta no es del comercio', internalUserId: '42' });

    expect(revocado.status).toBe('rejected');
    expect(network.markQrReplaced).not.toHaveBeenCalled();
    await expect(revision.review('1', '7', '3', { approved: true, internalUserId: null })).rejects.toBeInstanceOf(ConflictException);
  });

  it('un QR archivado o ya rechazado no admite revisión: los cobros hechos contra él tienen que seguir siendo explicables', async () => {
    const { revision } = construir({ porId: qr({ id: '3', status: 'replaced' }) });
    await expect(revision.review('1', '7', '3', { approved: false, note: 'x', internalUserId: null })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('un QR de otro comercio no existe para esta revisión', async () => {
    const { revision } = construir({ porId: null });
    await expect(revision.review('1', '7', '8', { approved: true, internalUserId: null })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PartnerQrService · lo que ve el cliente', () => {
  it('entrega la imagen bancaria aprobada para una caja activa del mismo comercio', async () => {
    const { service } = construir({ active: qr({ id: '8', status: 'active' }) });
    const result = await service.paymentQrForPos('1', '7', '9');
    expect(result?.imageDataUrl).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(result?.qrId).toBe('8');
    expect(result?.bankInstitutionCode).toBe('BNB');
    expect(result?.accountNumberMasked).toBe('****1234');
  });

  it('rechaza una caja que ya no está activa', async () => {
    const { service, network } = construir({ active: qr({ status: 'active' }) });
    network.findPosById.mockResolvedValueOnce({ id: '9', status: 'suspended', partnerProfileId: '7', branchId: '3' });
    await expect(service.paymentQrForPos('1', '7', '9')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('no entrega el QR bancario al pedir una caja ajena al comercio', async () => {
    const { service, network, storage } = construir({ active: qr({ status: 'active' }) });
    network.findPosById.mockResolvedValueOnce(null as never);
    await expect(service.paymentQrForPos('1', '7', '99')).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.readObject).not.toHaveBeenCalled();
  });

  it('no entrega una imagen que falta en el almacenamiento', async () => {
    const { service, storage } = construir({ active: qr({ status: 'active' }) });
    storage.readObject.mockResolvedValueOnce(null as never);
    await expect(service.paymentQrForPos('1', '7', '9')).resolves.toBeNull();
  });

  it('el QR de cobro que se enseña es SÓLO el activo, nunca el que espera revisión', async () => {
    const { service, network } = construir({ active: null, live: qr({ status: 'pending_review' }) });
    expect(await service.findLivePaymentQr('1', '7')).toBeNull();
    expect(network.findActiveQr).toHaveBeenCalledWith('1', '7', 'bank', null);
    expect(await service.hasPaymentQrPendingReview('1', '7')).toBe(true);
  });

  it('sin QR en revisión ni activo, «pendiente de revisión» es falso', async () => {
    const { service } = construir({ active: null, live: null });
    expect(await service.hasPaymentQrPendingReview('1', '7')).toBe(false);
  });
});

describe('PartnerQrService · registrar un QR nuevo', () => {
  const dto = {
    qrKind: 'bank' as const,
    storageKey: '1/partner-7/qr-bank/nuevo.png',
    bankInstitutionCode: 'BNB',
    accountNumberMasked: '****1',
  };

  it('nace ACTIVO sin revisión de Atlas, archiva lo vivo del ámbito ANTES de activar el nuevo, y avisa al comercio', async () => {
    const activo = qr({ id: '3', status: 'active' });
    const { service, network, notice, profiles } = construir({ live: activo });

    const creado = await service.register('1', '7', dto);

    expect(creado.status).toBe('active');
    const ambito = { tenantId: '1', partnerProfileId: '7', qrKind: 'bank', branchId: null };
    expect(network.archiveLiveQrs).toHaveBeenCalledWith(ambito, '99', { transaction: TX });
    expect(network.markQrActive).toHaveBeenCalledWith(expect.objectContaining({ id: '99' }), expect.any(String), { transaction: TX });
    // Orden: lo viejo se archiva antes de que el nuevo quede activo (índice único de un activo por ámbito).
    expect(network.archiveLiveQrs.mock.invocationCallOrder[0]).toBeLessThan(network.markQrActive.mock.invocationCallOrder[0] ?? 0);
    expect(notice.avisarCambioDeQrDeCobro).toHaveBeenCalledWith(
      await profiles.requireProfile(),
      expect.objectContaining({ id: '99', status: 'active' }),
    );
  });

  /*
   * Antes de #162 convivían un activo y un pendiente en el mismo ámbito, y la migración
   * 20261002170000 dejó esos pendientes. `register` archivaba SÓLO el que devolvía `findLiveQr`
   * (uno, sin orden): si salía el pendiente, el activo seguía en pie y activar el nuevo chocaba
   * con el índice único, con el pendiente ya archivado y el nuevo huérfano. Ahora no elige uno:
   * archiva todo lo vivo del ámbito, y lo hace con el nuevo en la MISMA transacción.
   */
  it('archiva TODO lo vivo del ámbito, no un QR elegido con `findLiveQr`, y todo en una transacción', async () => {
    const { service, network } = construir({ live: qr({ id: '4', status: 'pending_review' }) });

    await service.register('1', '7', dto);

    expect(network.findLiveQr).not.toHaveBeenCalled();
    expect(network.markQrReplaced).not.toHaveBeenCalled();
    expect(network.inTransaction).toHaveBeenCalledTimes(1);
    expect(network.createQrCode).toHaveBeenCalledWith(expect.objectContaining({ qrKind: 'bank' }), { transaction: TX });
    expect(network.archiveLiveQrs).toHaveBeenCalledTimes(1);
  });

  it('si la activación choca con el índice único, el error sale y no se avisa de un cambio que no ocurrió', async () => {
    const { service, network, notice, hooks } = construir({ live: qr({ id: '3', status: 'active' }) });
    network.markQrActive.mockRejectedValueOnce(new Error('partner_qr_codes_activo_por_ambito_key') as never);

    await expect(service.register('1', '7', dto)).rejects.toThrow('partner_qr_codes_activo_por_ambito_key');

    expect(notice.avisarCambioDeQrDeCobro).not.toHaveBeenCalled();
    expect(hooks.alRegistrarArchivoDelComercio).not.toHaveBeenCalled();
  });

  it('sin QR anterior queda activo igual', async () => {
    const { service } = construir({ live: null });
    const creado = await service.register('1', '7', dto);
    expect(creado.status).toBe('active');
  });

  /*
   * ERP-03: cambiar el QR bancario cambia a qué cuenta pagan los clientes. Queda en la auditoría
   * operativa quién, desde dónde y de qué cuenta a cuál —enmascaradas aunque el cliente mandara el
   * número entero—, en la MISMA transacción que el cambio.
   */
  it('audita el cambio con la cuenta anterior y la nueva ENMASCARADAS, quién lo hizo y dentro de la transacción', async () => {
    const anterior = qr({ id: '3', status: 'active', accountNumberMasked: '1234567890', sha256: 'c'.repeat(64) });
    const { service, audit } = construir({ active: anterior });
    const actor = {
      actorType: 'merchant_user',
      merchantUserId: '55',
      internalUserId: null,
      reauthenticated: true,
      ip: '10.0.0.1',
      userAgent: 'jest',
    };

    await service.register('1', '7', { ...dto, accountNumberMasked: 'cuenta 9876543210' }, { actor });

    expect(audit.recordQrChange).toHaveBeenCalledTimes(1);
    const [valores, opciones] = audit.recordQrChange.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(opciones).toEqual({ transaction: TX });
    expect(valores).toMatchObject({
      tenantId: '1',
      partnerId: '7',
      qrKind: 'bank',
      branchId: null,
      actor,
      previous: { qrId: '3', bankInstitutionCode: 'BNB', accountNumberMasked: '****7890', fingerprint: 'c'.repeat(12) },
      next: { qrId: '99', accountNumberMasked: '****3210' },
    });
    expect(JSON.stringify(valores)).not.toContain('9876543210');
  });

  it('sin QR activo anterior, el «antes» es null; sin contexto (carga del ERP) el actor es `system`', async () => {
    const { service, audit } = construir({ active: null });

    await service.register('1', '7', dto);

    expect(audit.recordQrChange).toHaveBeenCalledWith(
      expect.objectContaining({ previous: null, actor: expect.objectContaining({ actorType: 'system', reauthenticated: false }) }),
      { transaction: TX },
    );
  });

  it('la prueba de reautenticación se gasta DESPUÉS de validar la imagen y ANTES de escribir', async () => {
    const { service, network } = construir();
    const beforeWrite = jest.fn(async () => undefined);

    await service.register('1', '7', dto, { beforeWrite });

    expect(beforeWrite).toHaveBeenCalledTimes(1);
    expect(beforeWrite.mock.invocationCallOrder[0]).toBeLessThan(network.inTransaction.mock.invocationCallOrder[0] ?? 0);
  });

  it('si la prueba no vale, no se escribe nada ni se avisa', async () => {
    const { service, network, notice, audit } = construir();
    const beforeWrite = jest.fn(async () => {
      throw new Error('REAUTH_REQUIRED');
    });

    await expect(service.register('1', '7', dto, { beforeWrite })).rejects.toThrow('REAUTH_REQUIRED');

    expect(network.createQrCode).not.toHaveBeenCalled();
    expect(audit.recordQrChange).not.toHaveBeenCalled();
    expect(notice.avisarCambioDeQrDeCobro).not.toHaveBeenCalled();
  });

  it('una imagen sin QR se rechaza sin gastar la prueba: el comercio corrige y reintenta sin volver a teclear', async () => {
    const { service, storage } = construir();
    storage.readObject.mockResolvedValueOnce(Buffer.from('no es una imagen con qr') as never);
    const beforeWrite = jest.fn(async () => undefined);

    await expect(service.register('1', '7', dto, { beforeWrite })).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(beforeWrite).not.toHaveBeenCalled();
  });

  it('una clave fuera del expediente se rechaza antes de mirar el almacén', async () => {
    const { service, storage } = construir();
    await expect(service.register('1', '7', { ...dto, storageKey: '1/partner-77/qr-bank/ajeno.png' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(storage.readObjectMetadata).not.toHaveBeenCalled();
  });
});
