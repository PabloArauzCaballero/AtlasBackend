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
    sha256: 'a'.repeat(64),
    ...partial,
  };
}

const PNG = qrPng();

function construir(opciones: { live?: Qr | null; active?: Qr | null; porId?: Qr | null } = {}) {
  const network = {
    findLiveQr: jest.fn(async (..._args: unknown[]) => opciones.live ?? null),
    findActiveQr: jest.fn(async (..._args: unknown[]) => opciones.active ?? null),
    findQrById: jest.fn(async (..._args: unknown[]) => opciones.porId ?? null),
    createQrCode: jest.fn(async (values: Record<string, unknown>) => ({ ...values, id: '99', status: 'pending_review' })),
    markQrReplaced: jest.fn(async (viejo: Qr, nuevoId: string) => ({ ...viejo, status: 'replaced', replacedById: nuevoId })),
    markQrReviewed: jest.fn(async (target: Qr, review: Record<string, unknown>) => ({ ...target, ...review, verifiedAt: new Date() })),
    listQrCodesPendingReview: jest.fn(async () => []),
    findBranchById: jest.fn(async () => null),
    listQrCodes: jest.fn(async () => []),
  };
  const profiles = { requireProfile: jest.fn(async () => ({ id: '7', onboardingStatus: 'approved' })) };
  const storage = {
    isConfigured: () => true,
    readObjectMetadata: jest.fn(async () => ({ contentType: 'image/png', sizeBytes: PNG.byteLength, sha256Hex: 'b'.repeat(64) })),
    readObject: jest.fn(async () => PNG),
  };
  const metrics = { recordPartnerOnboardingStep: jest.fn() };
  const hooks = { alRegistrarArchivoDelComercio: jest.fn(async (..._args: unknown[]) => undefined) };
  const service = new PartnerQrService(network as never, profiles as never, storage as never, metrics as never, hooks as never);
  const revision = new PartnerQrReviewService(network as never, profiles as never, metrics as never);
  return { service, revision, network, profiles, storage, metrics, hooks };
}

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

  it('un QR que no está en revisión responde 409: un QR aprobado se reemplaza, no se «des-aprueba»', async () => {
    const { revision } = construir({ porId: qr({ id: '3', status: 'active' }) });
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

  it('NO retira el QR activo: sigue cobrando hasta que el nuevo se apruebe', async () => {
    const activo = qr({ id: '3', status: 'active' });
    const { service, network } = construir({ live: activo });

    const creado = await service.register('1', '7', dto);

    expect(creado.status).toBe('pending_review');
    expect(network.markQrReplaced).not.toHaveBeenCalled();
  });

  it('sí archiva un QR anterior que todavía esperaba revisión: el comercio lo corrigió antes de que nadie lo mirara', async () => {
    const pendiente = qr({ id: '4', status: 'pending_review' });
    const { service, network } = construir({ live: pendiente });

    await service.register('1', '7', dto);

    expect(network.markQrReplaced).toHaveBeenCalledWith(pendiente, '99');
  });

  it('una clave fuera del expediente se rechaza antes de mirar el almacén', async () => {
    const { service, storage } = construir();
    await expect(service.register('1', '7', { ...dto, storageKey: '1/partner-77/qr-bank/ajeno.png' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(storage.readObjectMetadata).not.toHaveBeenCalled();
  });
});
