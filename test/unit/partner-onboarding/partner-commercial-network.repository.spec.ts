import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { PartnerCommercialNetworkRepository } from '../../../src/modules/partner-onboarding/partner-commercial-network.repository.js';
import type {
  PartnerBranchModel,
  PartnerLegalRepresentativeModel,
  PartnerPosTerminalModel,
  PartnerQrCodeModel,
} from '../../../src/database/models/index.js';

/**
 * La red comercial del comercio: representantes, sucursales, QR y cajas.
 *
 * Es lo que hace que una venta se pueda atribuir a un local y a una caja concretos, y por eso las
 * tres reglas que se fijan aquí son de trazabilidad, no de forma. La primera: el QR de la EMPRESA
 * entera se busca con `IS NULL` y no con una igualdad, porque en SQL `NULL = NULL` no es cierto
 * nunca —con una igualdad la búsqueda devuelve siempre vacío y se crea un QR nuevo en cada intento,
 * dejando al comercio con una pila de códigos vigentes—. La segunda: un terminal sella cuándo entró
 * en servicio la PRIMERA vez y no se vuelve a tocar, porque esa fecha es desde cuándo pudo cobrar y
 * reescribirla al reactivarlo borra justo el tramo que una investigación necesita mirar. La tercera:
 * el número de serie se busca ignorando los retirados, que es lo que permite reutilizarlo.
 */
type Doble = { create: jest.Mock; findOne: jest.Mock; findAll: jest.Mock };

function doble(): Doble {
  return { create: jest.fn(async () => ({ id: 'x' })), findOne: jest.fn(async () => null), findAll: jest.fn(async () => []) };
}

function ultima(mock: jest.Mock): { where: Record<string | symbol, unknown>; order?: unknown[]; transaction?: unknown } {
  return mock.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> };
}

describe('PartnerCommercialNetworkRepository', () => {
  let representatives: Doble;
  let branches: Doble;
  let qrs: Doble;
  let pos: Doble;
  let repo: PartnerCommercialNetworkRepository;
  const tx = {} as never;

  beforeEach(() => {
    representatives = doble();
    branches = doble();
    qrs = doble();
    pos = doble();
    repo = new PartnerCommercialNetworkRepository(
      representatives as unknown as typeof PartnerLegalRepresentativeModel,
      branches as unknown as typeof PartnerBranchModel,
      qrs as unknown as typeof PartnerQrCodeModel,
      pos as unknown as typeof PartnerPosTerminalModel,
    );
  });

  describe('representantes legales', () => {
    it('se listan por comercio y tenant, en el orden en que se registraron', async () => {
      await repo.listRepresentatives('t1', 'pp-1', { transaction: tx });

      expect(ultima(representatives.findAll).where).toEqual({ tenantId: 't1', partnerProfileId: 'pp-1' });
      expect(ultima(representatives.findAll).order).toEqual([['_id', 'ASC']]);
      expect(ultima(representatives.findAll).transaction).toBe(tx);
    });

    it('se sella la fecha de alta al crear: el poder notarial vale desde una fecha, no desde siempre', async () => {
      await repo.createRepresentative(
        {
          tenantId: 't1',
          partnerProfileId: 'pp-1',
          fullName: 'Ana Rojas',
          documentType: 'CI',
          documentNumber: '123',
          powerOfAttorneyKey: 'k/poder.pdf',
        },
        { transaction: tx },
      );

      const [values, opciones] = representatives.create.mock.calls.at(-1) as [Record<string, unknown>, { transaction: unknown }];
      expect(values.createdAtValue).toBeInstanceOf(Date);
      expect(values.fullName).toBe('Ana Rojas');
      expect(opciones.transaction).toBe(tx);
    });
  });

  describe('sucursales', () => {
    it('se listan por código para que el operador las reconozca, no por id interno', async () => {
      await repo.listBranches('t1', 'pp-1');

      expect(ultima(branches.findAll).where).toEqual({ tenantId: 't1', partnerProfileId: 'pp-1' });
      expect(ultima(branches.findAll).order).toEqual([['branch_code', 'ASC']]);
    });

    it('una sucursal por id exige además su comercio: un id ajeno no debe resolverse', async () => {
      await repo.findBranchById('t1', 'pp-1', 'b-9');

      expect(ultima(branches.findOne).where).toEqual({ tenantId: 't1', partnerProfileId: 'pp-1', id: 'b-9' });
    });

    it('nace activa: una sucursal registrada ya puede vender', async () => {
      await repo.createBranch({
        tenantId: 't1',
        partnerProfileId: 'pp-1',
        branchCode: 'SUC-01',
        name: 'Centro',
        addressLine: null,
        city: null,
        latitude: null,
        longitude: null,
        erpBranchId: null,
      });

      const [values] = branches.create.mock.calls.at(-1) as [Record<string, unknown>];
      expect(values.status).toBe('active');
      expect(values.createdAtValue).toBeInstanceOf(Date);
    });
  });

  describe('códigos QR', () => {
    it('se listan del más nuevo al más viejo: el vigente es el que interesa', async () => {
      await repo.listQrCodes('t1', 'pp-1');

      expect(ultima(qrs.findAll).order).toEqual([['_id', 'DESC']]);
    });

    it('el QR de la EMPRESA se busca con `IS NULL`: una igualdad contra NULL no acierta nunca', async () => {
      await repo.findLiveQr('t1', 'pp-1', 'payment', null);

      const condicion = ultima(qrs.findOne).where;
      expect((condicion.branchId as Record<symbol, null>)[Op.is]).toBeNull();
    });

    it('el QR de una sucursal se busca por su identificador', async () => {
      await repo.findLiveQr('t1', 'pp-1', 'payment', 'b-9');

      expect(ultima(qrs.findOne).where.branchId).toBe('b-9');
    });

    it('«vigente» incluye el que está en revisión: si no, se crearía otro mientras se revisa el primero', async () => {
      await repo.findLiveQr('t1', 'pp-1', 'payment', null);

      expect((ultima(qrs.findOne).where.status as Record<symbol, string[]>)[Op.in]).toEqual(['pending_review', 'active']);
    });

    it('un QR nuevo nace en revisión y nunca activo: nadie sube un código de cobro y cobra en el acto', async () => {
      await repo.createQrCode({
        tenantId: 't1',
        partnerProfileId: 'pp-1',
        branchId: null,
        qrKind: 'payment',
        storageKey: 'k/qr.png',
        contentType: 'image/png',
        sizeBytes: 1024,
        sha256: 'h1',
        bankInstitutionCode: null,
        accountNumberMasked: null,
      });

      const [values] = qrs.create.mock.calls.at(-1) as [Record<string, unknown>];
      expect(values.status).toBe('pending_review');
      expect(values.createdAtValue).toBeInstanceOf(Date);
    });

    it('reemplazar deja apuntando al sucesor en vez de borrar el anterior', async () => {
      const update = jest.fn(async (_valores?: unknown, _opciones?: unknown) => undefined);

      await repo.markQrReplaced({ update } as unknown as PartnerQrCodeModel, 'qr-nuevo', { transaction: tx });

      const [values, opciones] = update.mock.calls.at(-1) as [Record<string, unknown>, { transaction: unknown }];
      expect(values.status).toBe('replaced');
      expect(values.replacedById).toBe('qr-nuevo');
      expect(values.updatedAtValue).toBeInstanceOf(Date);
      expect(opciones.transaction).toBe(tx);
    });
  });

  describe('cajas', () => {
    it('se listan por comercio en el orden en que se dieron de alta', async () => {
      await repo.listPosTerminals('t1', 'pp-1');

      expect(ultima(pos.findAll).where).toEqual({ tenantId: 't1', partnerProfileId: 'pp-1' });
      expect(ultima(pos.findAll).order).toEqual([['_id', 'ASC']]);
    });

    it('el número de serie se busca ignorando los retirados: por eso puede reutilizarse', async () => {
      await repo.findPosBySerial('t1', 'SN-123');

      const condicion = ultima(pos.findOne).where;
      expect(condicion.terminalSerial).toBe('SN-123');
      expect((condicion.status as Record<symbol, string>)[Op.ne]).toBe('retired');
      expect(condicion).not.toHaveProperty('partnerProfileId');
    });

    it('una caja por id sí exige su comercio', async () => {
      await repo.findPosById('t1', 'pp-1', 'pos-9');

      expect(ultima(pos.findOne).where).toEqual({ tenantId: 't1', partnerProfileId: 'pp-1', id: 'pos-9' });
    });

    it('nace registrada y no activa: activarla es un paso aparte', async () => {
      await repo.createPosTerminal({
        tenantId: 't1',
        partnerProfileId: 'pp-1',
        branchId: 'b-1',
        terminalSerial: 'SN-123',
        terminalAlias: null,
        provider: null,
        model: null,
      });

      const [values] = pos.create.mock.calls.at(-1) as [Record<string, unknown>];
      expect(values.status).toBe('registered');
    });

    it('la primera activación sella desde cuándo la caja pudo cobrar', async () => {
      const update = jest.fn(async (_valores?: unknown, _opciones?: unknown) => undefined);
      const terminal = { activatedAt: null, update } as unknown as PartnerPosTerminalModel;

      await repo.updatePosStatus(terminal, 'active');

      const [values] = update.mock.calls.at(-1) as [Record<string, unknown>];
      expect(values.activatedAt).toBeInstanceOf(Date);
    });

    it('reactivarla NO reescribe esa fecha: borraría el tramo que una investigación mira', async () => {
      const original = new Date('2026-01-01T00:00:00Z');
      const update = jest.fn(async (_valores?: unknown, _opciones?: unknown) => undefined);
      const terminal = { activatedAt: original, update } as unknown as PartnerPosTerminalModel;

      await repo.updatePosStatus(terminal, 'active');

      const [values] = update.mock.calls.at(-1) as [Record<string, unknown>];
      expect(values.activatedAt).toBe(original);
    });

    it('suspenderla sin haberse activado nunca la deja sin fecha, no con la de hoy', async () => {
      const update = jest.fn(async (_valores?: unknown, _opciones?: unknown) => undefined);
      const terminal = { activatedAt: null, update } as unknown as PartnerPosTerminalModel;

      await repo.updatePosStatus(terminal, 'suspended');

      const [values] = update.mock.calls.at(-1) as [Record<string, unknown>];
      expect(values.status).toBe('suspended');
      expect(values.activatedAt).toBeNull();
    });
  });
});
